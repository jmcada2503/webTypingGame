import * as THREE from 'three';
import '@fontsource/ibm-plex-mono/400.css';
import { ASCII_STYLE, type ViewportFit } from './asciiStyle';
import type { AsciiRenderer, PaletteColor, TextGrid } from './AsciiRenderer';

/** Every glyph the atlas holds: printable ASCII, Spanish letters, ramp, Cockpit symbols. */
const CHARSET = Array.from(
  new Set([
    ...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)),
    ...'ñÑáéíóúüÁÉÍÓÚÜ♥',
    ...ASCII_STYLE.ramp,
  ]),
);
const GLYPH = new Map(CHARSET.map((ch, i) => [ch, i]));
const glyphIndex = (ch: string) => GLYPH.get(ch) ?? GLYPH.get('?')!;

/** Palette slots in the composite shader. */
const PALETTE: Record<PaletteColor, number> = { fg: 0, red: 1, green: 2, dim: 3, yellow: 4 };
const RAMP_MAX = 32;

const hexToVec3 = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

/** Text cells stored in an RGBA byte texture: r = glyph + 1 (0 = empty), g = palette slot. */
class DataTextGrid implements TextGrid {
  readonly cols = ASCII_STYLE.grid.cols;
  readonly rows = ASCII_STYLE.grid.rows;
  readonly data = new Uint8Array(this.cols * this.rows * 4);
  readonly texture = new THREE.DataTexture(this.data, this.cols, this.rows, THREE.RGBAFormat, THREE.UnsignedByteType);

  constructor() {
    this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter;
    this.texture.needsUpdate = true;
  }

  private put(col: number, row: number, ch: string, color: PaletteColor) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return;
    // Texture row 0 is the bottom of the screen; TextGrid row 0 is the top.
    const o = ((this.rows - 1 - row) * this.cols + col) * 4;
    this.data[o] = glyphIndex(ch) + 1;
    this.data[o + 1] = PALETTE[color];
    this.texture.needsUpdate = true;
  }

  write(col: number, row: number, text: string, color: PaletteColor = 'fg') {
    [...text].forEach((ch, i) => this.put(col + i, row, ch, color));
  }

  fill(col: number, row: number, width: number, height: number, char = ' ', color: PaletteColor = 'fg') {
    for (let y = row; y < row + height; y++) for (let x = col; x < col + width; x++) this.put(x, y, char, color);
  }

  clear() {
    this.data.fill(0);
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
  }
}

const FULLSCREEN_VERT = 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }';

/**
 * GPU ASCII pipeline (WebGL2, three.js):
 *  1. scene → sceneRT at the reference size (grid × reference cell, 1280×720)
 *  2. cell pass: average brightness per cell → ramp glyph; clearly red/green cells keep that accent (cellRT, 128×45)
 *  3. composite: glyph atlas at the real device cell size; TextGrid cells win over shading
 *  4. optional overlay scene drawn on top with no ASCII treatment
 */
export class GpuAsciiRenderer implements AsciiRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly textGrid: DataTextGrid;

  private readonly gl: THREE.WebGLRenderer;
  private readonly sceneRT: THREE.WebGLRenderTarget;
  private readonly cellRT: THREE.WebGLRenderTarget;
  private atlas: THREE.CanvasTexture | null = null;
  private readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad = new THREE.PlaneGeometry(2, 2);
  private readonly cellPass: { scene: THREE.Scene; mat: THREE.ShaderMaterial };
  private readonly compositePass: { scene: THREE.Scene; mat: THREE.ShaderMaterial };

  /** Use this instead of the constructor: waits for the font so the atlas is drawn with it. */
  static async create(): Promise<GpuAsciiRenderer> {
    await document.fonts.load(`16px "${ASCII_STYLE.font.family}"`, CHARSET.join(''));
    return new GpuAsciiRenderer();
  }

  private constructor() {
    const { grid, referenceCell, ramp, luminance, palette } = ASCII_STYLE;
    this.gl = new THREE.WebGLRenderer({ antialias: false });
    this.gl.setPixelRatio(1);
    this.canvas = this.gl.domElement;
    this.textGrid = new DataTextGrid();

    const refW = grid.cols * referenceCell.width;
    const refH = grid.rows * referenceCell.height;
    this.sceneRT = new THREE.WebGLRenderTarget(refW, refH, {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    this.cellRT = new THREE.WebGLRenderTarget(grid.cols, grid.rows, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
    });

    const rampGlyphs = [...ramp].slice(0, RAMP_MAX).map(glyphIndex);
    this.cellPass = this.pass(
      /* glsl */ `
      precision highp float;
      uniform sampler2D tColor;
      uniform ivec2 cell; uniform float exposure; uniform float gamma;
      uniform float ramp[${RAMP_MAX}]; uniform int rampLen;
      out vec4 outColor;
      void main() {
        ivec2 origin = ivec2(gl_FragCoord.xy) * cell;
        vec3 sum = vec3(0.0);
        for (int y = 0; y < 64; y++) { if (y >= cell.y) break;
          for (int x = 0; x < 64; x++) { if (x >= cell.x) break;
            sum += texelFetch(tColor, origin + ivec2(x, y), 0).rgb;
          }
        }
        vec3 c = sum / float(cell.x * cell.y);
        // Brightness = strongest channel, so pure red / green objects shade like white ones.
        float L = clamp(pow(clamp(max(c.r, max(c.g, c.b)) * exposure, 0.0, 1.0), gamma), 0.0, 1.0);
        int idx = int(floor(L * (float(rampLen) - 0.001)));
        // Clearly green / red / yellow cells keep that accent (palette slot 2 / 1 / 4); else fg.
        float pal = 0.0;
        if (c.g > 0.01 && c.g > 1.6 * c.r && c.g > 1.6 * c.b) pal = 2.0;
        else if (c.r > 0.01 && c.g > 0.35 * c.r && c.g < 0.9 * c.r && c.r > 3.0 * c.b) pal = 4.0;
        else if (c.r > 0.01 && c.r > 2.5 * c.g && c.r > 2.5 * c.b) pal = 1.0;
        outColor = vec4(ramp[idx] / 255.0, pal / 255.0, L, 1.0);
      }`,
      {
        tColor: { value: this.sceneRT.texture },
        cell: { value: new THREE.Vector2(referenceCell.width, referenceCell.height) },
        exposure: { value: luminance.exposure },
        gamma: { value: luminance.gamma },
        ramp: { value: Array.from({ length: RAMP_MAX }, (_, i) => rampGlyphs[Math.min(i, rampGlyphs.length - 1)]) },
        rampLen: { value: rampGlyphs.length },
      },
    );

    this.compositePass = this.pass(
      /* glsl */ `
      precision highp float;
      uniform sampler2D tCells; uniform sampler2D tText; uniform sampler2D tAtlas;
      uniform ivec2 cellDev; uniform ivec2 grid; uniform vec3 palette[5]; uniform vec3 bg;
      out vec4 outColor;
      void main() {
        ivec2 px = ivec2(gl_FragCoord.xy);
        ivec2 c = px / cellDev;
        if (c.x >= grid.x || c.y >= grid.y) { outColor = vec4(bg, 1.0); return; }
        vec4 cell = texelFetch(tCells, c, 0);
        float glyph = cell.r * 255.0;
        int pal = int(cell.g * 255.0 + 0.5);
        vec4 t = texelFetch(tText, c, 0);
        if (t.r > 0.0) { glyph = t.r * 255.0 - 1.0; pal = int(t.g * 255.0 + 0.5); }
        ivec2 local = px - c * cellDev;
        float a = texelFetch(tAtlas, ivec2(int(glyph + 0.5) * cellDev.x + local.x, local.y), 0).a;
        outColor = vec4(mix(bg, palette[pal], a), 1.0);
      }`,
      {
        tCells: { value: this.cellRT.texture },
        tText: { value: this.textGrid.texture },
        tAtlas: { value: null },
        cellDev: { value: new THREE.Vector2(1, 1) },
        grid: { value: new THREE.Vector2(grid.cols, grid.rows) },
        palette: { value: [palette.fg, palette.red, palette.green, palette.dim, palette.yellow].map(hexToVec3) },
        bg: { value: hexToVec3(palette.bg) },
      },
    );
  }

  private pass(frag: string, uniforms: Record<string, THREE.IUniform>) {
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: frag,
    });
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(this.quad, mat));
    return { scene, mat };
  }

  resize(fit: ViewportFit) {
    this.gl.setSize(fit.canvasW, fit.canvasH, false);
    this.buildAtlas(fit);
    const u = this.compositePass.mat.uniforms;
    u.cellDev.value.set(fit.cellW, fit.cellH);
    u.tAtlas.value = this.atlas;
  }

  /** One row of glyphs, each drawn into a cellW×cellH slot at the real device font size. */
  private buildAtlas(fit: ViewportFit) {
    const { cellW, cellH } = fit;
    const cv = document.createElement('canvas');
    cv.width = cellW * CHARSET.length;
    cv.height = cellH;
    const ctx = cv.getContext('2d')!;
    ctx.font = `${fit.fontPx}px "${ASCII_STYLE.font.family}"`;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    CHARSET.forEach((ch, i) => ctx.fillText(ch, i * cellW + cellW / 2, cellH / 2 + cellH / 16));
    this.atlas?.dispose();
    this.atlas = new THREE.CanvasTexture(cv);
    this.atlas.minFilter = this.atlas.magFilter = THREE.NearestFilter;
    this.atlas.generateMipmaps = false;
  }

  render(scene: THREE.Scene, camera: THREE.Camera, overlay?: { scene: THREE.Scene; camera: THREE.Camera }) {
    const gl = this.gl;
    gl.setClearColor(0x000000, 1);
    gl.setRenderTarget(this.sceneRT);
    gl.render(scene, camera);
    gl.setRenderTarget(this.cellRT);
    gl.render(this.cellPass.scene, this.ortho);
    gl.setRenderTarget(null);
    gl.render(this.compositePass.scene, this.ortho);
    if (overlay) {
      gl.autoClear = false;
      gl.render(overlay.scene, overlay.camera);
      gl.autoClear = true;
    }
  }

  dispose() {
    this.sceneRT.dispose();
    this.cellRT.dispose();
    this.atlas?.dispose();
    this.textGrid.dispose();
    this.cellPass.mat.dispose();
    this.compositePass.mat.dispose();
    this.quad.dispose();
    this.gl.dispose();
  }
}
