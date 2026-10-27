// PROTOTYPE — throwaway. Answers: "Does three.js + a custom GPU ASCII pipeline give the look we want,
// and which ramp / cell / font / palette / lighting do we lock?"
// Three radically different presets via ?variant=A|B|C (bottom bar, ← →), every knob live in the panel.
// Pipeline: scene → (color+depth, normals) → per-pixel edge pass → per-cell classify → glyph composite.
import * as THREE from 'three';
import GUI from 'lil-gui';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/ibm-plex-mono/400.css';
import { mountPrototypeSwitcher } from '../shared/PrototypeSwitcher';

// W×H = scene render resolution (reference). The grid = W/cellW × H/cellH; on screen, cells scale to fit the window.
const W = 1280;
const H = 720;
let DPR = window.devicePixelRatio || 1;
let fit = { cellW: 10, cellH: 16, canvasW: W, canvasH: H };

type Shape = 'cube' | 'sphere' | 'cube + sphere' | 'torus knot';
type Settings = {
  cellW: number; cellH: number;
  font: 'JetBrains Mono' | 'IBM Plex Mono'; fontPx: number;
  ramp: string;
  exposure: number; gamma: number;
  edges: boolean; edgeThreshold: number; horizEdge: '-' | '_'; flipDiagonals: boolean; edgeDebugColor: boolean;
  fg: string; bg: string; red: string; green: string; dim: string;
  shape: Shape; flatShading: boolean;
  lightX: number; lightY: number; lightZ: number; light: number; ambient: number;
  rotSpeed: number; hud: boolean; view: 'ascii' | 'raw color' | 'normals' | 'edges';
};

const BASE: Settings = {
  cellW: 8, cellH: 16, font: 'JetBrains Mono', fontPx: 13,
  ramp: ' .,-~:;=!*#$@',
  exposure: 1, gamma: 1,
  edges: true, edgeThreshold: 0.2, horizEdge: '-', flipDiagonals: false, edgeDebugColor: false,
  fg: '#ffffff', bg: '#000000', red: '#ff3b30', green: '#34c759', dim: '#5a5a5a',
  shape: 'cube', flatShading: true,
  lightX: -1, lightY: 1.2, lightZ: 1, light: 3.14, ambient: 0.25,
  rotSpeed: 0.6, hud: true, view: 'ascii',
};

const VARIANTS: { key: string; name: string; s: Partial<Settings> }[] = [
  { key: 'A', name: 'Research default: 8×16, donut ramp, edges', s: {} },
  {
    key: 'B', name: 'Chunky terminal: 10×20, short ramp, no edges, soft',
    s: { cellW: 10, cellH: 20, fontPx: 16, font: 'IBM Plex Mono', ramp: ' .:-=+*#%@', edges: false, fg: '#e0e0e0',
      shape: 'cube + sphere', flatShading: false, gamma: 0.8, ambient: 0.4 },
  },
  {
    key: 'C', name: 'Dense reference: 5×10, 70-level ramp, edges',
    s: { cellW: 5, cellH: 10, fontPx: 8.3, ramp: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
      shape: 'sphere', flatShading: false, gamma: 1.2, edgeThreshold: 0.25, lightX: -1.5, lightY: 1.5, lightZ: 0.6 },
  },
];

VARIANTS.push({
  key: 'L', name: 'LOCKED: 10×16, IBM Plex Mono 13, donut ramp, no edges',
  s: { cellW: 10, cellH: 16, font: 'IBM Plex Mono', fontPx: 13, ramp: ' .,-~:;=!*#$@', edges: false,
    light: 4.23, ambient: 0.25, rotSpeed: 0.53, shape: 'cube + sphere', flatShading: false },
});

const variantKey = mountPrototypeSwitcher(VARIANTS.map(({ key, name }) => ({ key, name })));
const S: Settings = { ...BASE, ...VARIANTS.find((v) => v.key === variantKey)!.s };
const qv = new URLSearchParams(location.search).get('view'); if (qv) S.view = qv as Settings['view'];

// ---------- renderer + scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);
document.body.prepend(renderer.domElement);
const stats = new Stats();
document.body.append(stats.dom);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 100);
camera.position.set(0, 0, 7);
const dirLight = new THREE.DirectionalLight(0xffffff, S.light);
const ambLight = new THREE.AmbientLight(0xffffff, S.ambient);
scene.add(dirLight, ambLight);
const litMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: S.flatShading });
const normalMat = new THREE.MeshNormalMaterial({ flatShading: S.flatShading });
const root = new THREE.Group();
scene.add(root);

function buildShape() {
  root.clear();
  const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), litMat);
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1.4, 48, 32), litMat);
  const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(1.1, 0.35, 160, 24), litMat);
  if (S.shape === 'cube') root.add(box);
  if (S.shape === 'sphere') root.add(sphere);
  if (S.shape === 'torus knot') root.add(knot);
  if (S.shape === 'cube + sphere') { box.position.x = -1.7; sphere.position.x = 1.7; root.add(box, sphere); }
}

// ---------- render targets ----------
const depthTex = new THREE.DepthTexture(W, H);
const sceneRT = new THREE.WebGLRenderTarget(W, H, { depthTexture: depthTex, type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
const normalRT = new THREE.WebGLRenderTarget(W, H, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
const edgeRT = new THREE.WebGLRenderTarget(W, H, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
let cellRT: THREE.WebGLRenderTarget;
let overlayTex: THREE.DataTexture;
let atlasTex: THREE.CanvasTexture;
let charset = '';

const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quadGeo = new THREE.PlaneGeometry(2, 2);
function pass(frag: string, uniforms: Record<string, THREE.IUniform>) {
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms, depthTest: false, depthWrite: false,
    vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: frag,
  });
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(quadGeo, mat));
  return { scene: s, mat };
}

// Pass 1: per-pixel edge mask + orientation.
// Mask: normal Sobel (creases) OR depth Laplacian on 1/z (silhouettes; planar faces give ~0, so no grazing-angle noise).
// Orientation: structure tensor of the combined normal + depth gradients.
const edgePass = pass(/* glsl */ `
  precision highp float;
  uniform sampler2D tNormal; uniform sampler2D tDepth;
  uniform float near; uniform float far; uniform float normalThresh; uniform float depthThresh;
  out vec4 outColor;
  vec3 N(ivec2 p) { vec4 n = texelFetch(tNormal, clamp(p, ivec2(0), ivec2(${W - 1}, ${H - 1})), 0); return (n.rgb * 2.0 - 1.0) * n.a; }
  float Z(ivec2 p) { // 1/linearZ: affine in screen space across a plane
    float d = texelFetch(tDepth, clamp(p, ivec2(0), ivec2(${W - 1}, ${H - 1})), 0).r * 2.0 - 1.0;
    return (far + near - d * (far - near)) / (2.0 * near * far);
  }
  void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    vec3 tl = N(p + ivec2(-1, 1)), t = N(p + ivec2(0, 1)), tr = N(p + ivec2(1, 1));
    vec3 l = N(p + ivec2(-1, 0)), r = N(p + ivec2(1, 0));
    vec3 bl = N(p + ivec2(-1, -1)), b = N(p + ivec2(0, -1)), br = N(p + ivec2(1, -1));
    vec3 ngx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
    vec3 ngy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
    float zc = Z(p), zl = Z(p + ivec2(-1, 0)), zr = Z(p + ivec2(1, 0)), zt = Z(p + ivec2(0, 1)), zb = Z(p + ivec2(0, -1));
    float lap = abs(zl + zr + zt + zb - 4.0 * zc) / max(zc, 1e-4);
    float dgx = (zr - zl) / max(zc, 1e-4), dgy = (zt - zb) / max(zc, 1e-4);
    float nmag = length(vec2(length(ngx), length(ngy)));
    bool edge = nmag > normalThresh || lap > depthThresh;
    float jxx = dot(ngx, ngx) + dgx * dgx, jyy = dot(ngy, ngy) + dgy * dgy, jxy = dot(ngx, ngy) + dgx * dgy;
    float theta = 0.5 * atan(2.0 * jxy, jxx - jyy); // gradient direction, (-pi/2, pi/2]
    float a = abs(theta);
    float bin = a < 0.3927 ? 0.0 : (a > 1.1781 ? 1.0 : (theta > 0.0 ? 2.0 : 3.0)); // | - \\ /
    outColor = vec4(edge ? 1.0 : 0.0, bin / 3.0, 0.0, 1.0);
  }`, {
  tNormal: { value: normalRT.texture }, tDepth: { value: depthTex }, near: { value: camera.near }, far: { value: camera.far },
  normalThresh: { value: 1.2 }, depthThresh: { value: 0.05 },
});

// Pass 2: per cell → glyph index (ramp by average luminance, or edge glyph by vote) + palette index.
const cellPass = pass(/* glsl */ `
  precision highp float;
  uniform sampler2D tColor; uniform sampler2D tEdge;
  uniform ivec2 cell; uniform float exposure; uniform float gamma;
  uniform float ramp[128]; uniform int rampLen;
  uniform float edgeGlyph[4]; uniform bool edgesOn; uniform float edgeThreshold;
  out vec4 outColor;
  void main() {
    ivec2 origin = ivec2(gl_FragCoord.xy) * cell;
    float lum = 0.0; int counts[4] = int[4](0, 0, 0, 0); int edgeCount = 0;
    for (int y = 0; y < 64; y++) { if (y >= cell.y) break;
      for (int x = 0; x < 64; x++) { if (x >= cell.x) break;
        ivec2 p = origin + ivec2(x, y);
        lum += dot(texelFetch(tColor, p, 0).rgb, vec3(0.2126, 0.7152, 0.0722));
        vec4 e = texelFetch(tEdge, p, 0);
        if (e.r > 0.5) { edgeCount++; counts[int(e.g * 3.0 + 0.5)]++; }
      }
    }
    float n = float(cell.x * cell.y);
    float L = clamp(pow(clamp(lum / n * exposure, 0.0, 1.0), gamma), 0.0, 1.0);
    int idx = int(floor(L * (float(rampLen) - 0.001)));
    float glyph = ramp[idx];
    float pal = 0.0;
    if (edgesOn && float(edgeCount) >= edgeThreshold * n) {
      int best = 0;
      for (int i = 1; i < 4; i++) if (counts[i] > counts[best]) best = i;
      glyph = edgeGlyph[best]; pal = 4.0 + float(best); // 4..7 = edge (debug colors)
    }
    outColor = vec4(glyph / 255.0, pal / 255.0, L, 1.0);
  }`, {
  tColor: { value: sceneRT.texture }, tEdge: { value: edgeRT.texture },
  cell: { value: new THREE.Vector2() }, exposure: { value: 1 }, gamma: { value: 1 },
  ramp: { value: new Array(128).fill(0) }, rampLen: { value: 1 },
  edgeGlyph: { value: [0, 0, 0, 0] }, edgesOn: { value: true }, edgeThreshold: { value: 0.1 },
});

// Pass 3: composite glyphs at device resolution. Overlay (HUD text) wins over shaded cells.
const PALETTE_SIZE = 8;
const compositePass = pass(/* glsl */ `
  precision highp float;
  uniform sampler2D tCells; uniform sampler2D tOverlay; uniform sampler2D tAtlas;
  uniform ivec2 cellDev; uniform ivec2 grid; uniform vec3 palette[${PALETTE_SIZE}]; uniform vec3 bg;
  uniform bool edgeDebug; uniform bool hud;
  out vec4 outColor;
  void main() {
    ivec2 px = ivec2(gl_FragCoord.xy);
    ivec2 c = px / cellDev;
    if (c.x >= grid.x || c.y >= grid.y) { outColor = vec4(bg, 1.0); return; }
    vec4 cv = texelFetch(tCells, c, 0);
    float glyph = cv.r * 255.0; int pal = int(cv.g * 255.0 + 0.5);
    if (!edgeDebug && pal >= 4) pal = 0;
    vec4 ov = texelFetch(tOverlay, c, 0);
    if (hud && ov.r > 0.0) { glyph = ov.r * 255.0 - 1.0; pal = int(ov.g * 255.0 + 0.5); }
    ivec2 local = px - c * cellDev;
    float a = texelFetch(tAtlas, ivec2(int(glyph + 0.5) * cellDev.x + local.x, local.y), 0).a;
    outColor = vec4(mix(bg, palette[pal], a), 1.0);
  }`, {
  tCells: { value: null }, tOverlay: { value: null }, tAtlas: { value: null },
  cellDev: { value: new THREE.Vector2() }, grid: { value: new THREE.Vector2() },
  palette: { value: Array.from({ length: PALETTE_SIZE }, () => new THREE.Vector3()) }, bg: { value: new THREE.Vector3() },
  edgeDebug: { value: false }, hud: { value: true },
});

const rawPass = pass(/* glsl */ `
  precision highp float; uniform sampler2D tColor; uniform bool srgb; uniform vec2 sceneScale; out vec4 outColor;
  void main(){ vec3 c = texelFetch(tColor, ivec2(gl_FragCoord.xy * sceneScale), 0).rgb; outColor = vec4(srgb ? pow(c, vec3(1.0/2.2)) : c, 1.0); }`,
  { tColor: { value: sceneRT.texture }, srgb: { value: true }, sceneScale: { value: new THREE.Vector2(1, 1) } });

// Largest integer device-px cell (keeping cellW:cellH) whose grid fits the window; letterboxed by CSS centering.
function computeFit() {
  DPR = window.devicePixelRatio || 1;
  const cols = Math.floor(W / S.cellW), rows = Math.floor(H / S.cellH);
  const k = Math.min((innerWidth * DPR) / (cols * S.cellW), (innerHeight * DPR) / (rows * S.cellH));
  const cellW = Math.max(1, Math.floor(S.cellW * k)), cellH = Math.max(1, Math.floor(S.cellH * k));
  fit = { cellW, cellH, canvasW: cellW * cols, canvasH: cellH * rows };
  renderer.setSize(fit.canvasW, fit.canvasH, false);
  renderer.domElement.style.width = `${fit.canvasW / DPR}px`;
  renderer.domElement.style.height = `${fit.canvasH / DPR}px`;
  rawPass.mat.uniforms.sceneScale.value.set(W / fit.canvasW, H / fit.canvasH);
  // Integer cells can't keep 10:16 exactly; match the camera to the real canvas shape so geometry isn't squashed.
  camera.aspect = fit.canvasW / fit.canvasH;
  camera.updateProjectionMatrix();
}

// ---------- glyph atlas + overlay ----------
const hex = (h: string) => {
  const n = parseInt(h.slice(1), 16);
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

async function buildAtlas() {
  const base = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('') + 'ñÑáéíóúü♥';
  charset = Array.from(new Set([...base, ...S.ramp, '|', '-', '_', '/', '\\'])).join('');
  const fontDevPx = (S.fontPx * fit.cellH) / S.cellH;
  const font = `${fontDevPx}px "${S.font}"`;
  await document.fonts.load(font, charset);
  const sw = fit.cellW, sh = fit.cellH;
  const cv = document.createElement('canvas');
  cv.width = sw * charset.length; cv.height = sh;
  const ctx = cv.getContext('2d')!;
  ctx.font = font; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  [...charset].forEach((ch, i) => ctx.fillText(ch, i * sw + sw / 2, sh / 2 + sh / 16));
  atlasTex?.dispose();
  atlasTex = new THREE.CanvasTexture(cv);
  atlasTex.minFilter = atlasTex.magFilter = THREE.NearestFilter;
  atlasTex.generateMipmaps = false;
}
const gi = (ch: string) => Math.max(0, charset.indexOf(ch));

function buildGrid() {
  const cols = Math.floor(W / S.cellW), rows = Math.floor(H / S.cellH);
  cellRT?.dispose();
  cellRT = new THREE.WebGLRenderTarget(cols, rows, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
  overlayTex?.dispose();
  const data = new Uint8Array(cols * rows * 4);
  overlayTex = new THREE.DataTexture(data, cols, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
  overlayTex.minFilter = overlayTex.magFilter = THREE.NearestFilter;
  // HUD mock: palette check for Lives, Typed word (green prefix), Attack word (red).
  const put = (col: number, rowFromTop: number, text: string, pal: number) => {
    [...text].forEach((ch, i) => {
      const x = col + i, y = rows - 1 - rowFromTop;
      if (x < 0 || x >= cols || y < 0) return;
      const o = (y * cols + x) * 4;
      data[o] = gi(ch) + 1; data[o + 1] = pal;
    });
  };
  const bottom = rows - 3;
  put(2, bottom, `LIVES ${'♥'.repeat(3)}`, 1);
  const typed = 'murci', target = 'murciélago';
  const mid = Math.floor(cols / 2) - Math.floor(target.length / 2);
  put(mid, bottom, typed, 2); put(mid + typed.length, bottom, target.slice(typed.length), 3);
  const atk = 'ñandú';
  put(cols - atk.length - 2, bottom, atk, 1);
  const fontDev = (S.fontPx * fit.cellH) / S.cellH;
  put(2, 1, `PROTOTYPE · grid ${cols}×${rows} · window ${innerWidth}×${innerHeight} @${DPR}x · cell ${fit.cellW}×${fit.cellH} device px · ${S.font} ${fontDev.toFixed(1)}px`, 3);
  overlayTex.needsUpdate = true;
}

async function rebuild() {
  computeFit();
  await buildAtlas();
  buildGrid();
  syncUniforms();
}

function syncUniforms() {
  const cu = cellPass.mat.uniforms;
  cu.cell.value.set(S.cellW, S.cellH);
  cu.exposure.value = S.exposure; cu.gamma.value = S.gamma;
  const ramp = [...S.ramp].slice(0, 128);
  cu.ramp.value = Array.from({ length: 128 }, (_, i) => gi(ramp[Math.min(i, ramp.length - 1)]));
  cu.rampLen.value = ramp.length;
  const diag = S.flipDiagonals ? ['/', '\\'] : ['\\', '/'];
  cu.edgeGlyph.value = [gi('|'), gi(S.horizEdge), gi(diag[0]), gi(diag[1])];
  cu.edgesOn.value = S.edges; cu.edgeThreshold.value = S.edgeThreshold;
  const pu = compositePass.mat.uniforms;
  pu.tCells.value = cellRT.texture; pu.tOverlay.value = overlayTex; pu.tAtlas.value = atlasTex;
  pu.cellDev.value.set(fit.cellW, fit.cellH);
  pu.grid.value.set(Math.floor(W / S.cellW), Math.floor(H / S.cellH));
  // 0 fg, 1 red, 2 green, 3 dim, 4..7 edge debug (| - \ /)
  const pal = [S.fg, S.red, S.green, S.dim, '#00e5ff', '#ffd400', '#ff00ff', '#7cff00'];
  pal.forEach((h, i) => pu.palette.value[i].copy(hex(h)));
  pu.bg.value.copy(hex(S.bg)); pu.edgeDebug.value = S.edgeDebugColor; pu.hud.value = S.hud;
  dirLight.position.set(S.lightX, S.lightY, S.lightZ); dirLight.intensity = S.light; ambLight.intensity = S.ambient;
  litMat.flatShading = normalMat.flatShading = S.flatShading;
  litMat.needsUpdate = normalMat.needsUpdate = true;
}

// ---------- tweak panel ----------
const gui = new GUI({ title: `Variant ${variantKey} knobs` });
const onRebuild = () => void rebuild();
const grid = gui.addFolder('Grid + font');
grid.add(S, 'cellW', [4, 5, 8, 10, 16]).onChange(onRebuild);
grid.add(S, 'cellH', [8, 10, 16, 20, 32]).onChange(onRebuild);
grid.add(S, 'font', ['JetBrains Mono', 'IBM Plex Mono']).onChange(onRebuild);
grid.add(S, 'fontPx', 5, 32, 0.1).onFinishChange(onRebuild);
grid.add(S, 'ramp', {
  'donut 13': ' .,-~:;=!*#$@', 'three.js 10': ' .:-=+*#%@',
  'bourke 70': " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$", 'blocks': ' ░▒▓█', 'minimal 5': ' .:+#',
}).onChange(onRebuild);
const shade = gui.addFolder('Shading + light');
shade.add(S, 'exposure', 0.2, 3, 0.01).onChange(syncUniforms);
shade.add(S, 'gamma', 0.3, 3, 0.01).onChange(syncUniforms);
shade.add(S, 'flatShading').onChange(syncUniforms);
shade.add(S, 'light', 0, 8, 0.01).onChange(syncUniforms);
shade.add(S, 'ambient', 0, 1, 0.01).onChange(syncUniforms);
shade.add(S, 'lightX', -3, 3, 0.1).onChange(syncUniforms);
shade.add(S, 'lightY', -3, 3, 0.1).onChange(syncUniforms);
shade.add(S, 'lightZ', -3, 3, 0.1).onChange(syncUniforms);
const edges = gui.addFolder('Edges');
edges.add(S, 'edges').onChange(syncUniforms);
edges.add(S, 'edgeThreshold', 0.02, 0.6, 0.01).onChange(syncUniforms);
edges.add(S, 'horizEdge', ['-', '_']).onChange(syncUniforms);
edges.add(S, 'flipDiagonals').onChange(syncUniforms);
edges.add(S, 'edgeDebugColor').onChange(syncUniforms);
const color = gui.addFolder('Palette');
(['fg', 'bg', 'red', 'green', 'dim'] as const).forEach((k) => color.addColor(S, k).onChange(syncUniforms));
const scn = gui.addFolder('Scene');
scn.add(S, 'shape', ['cube', 'sphere', 'cube + sphere', 'torus knot']).onChange(buildShape);
scn.add(S, 'rotSpeed', 0, 3, 0.01);
scn.add(S, 'hud').onChange(syncUniforms);
scn.add(S, 'view', ['ascii', 'raw color', 'normals', 'edges']);
(window as any).S = S; (window as any).syncUniforms = syncUniforms;
const toggleFullscreen = () => {
  const d = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  if (document.fullscreenElement || d.webkitFullscreenElement) (document.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
  else (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.());
};
gui.add({ fullscreen: toggleFullscreen }, 'fullscreen').name('⛶ fullscreen (F)');
addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('input,textarea,select')) return;
  if (e.key === 'f' || e.key === 'F') toggleFullscreen();
});
document.addEventListener('fullscreenchange', onRebuild);
document.addEventListener('webkitfullscreenchange', onRebuild);
gui.add({ copy: () => { const j = JSON.stringify(S, null, 2); console.log(j); void navigator.clipboard.writeText(j); } }, 'copy').name('📋 copy settings JSON');

// ---------- loop ----------
buildShape();
await rebuild();
let resizeTimer = 0;
addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = window.setTimeout(onRebuild, 100); });
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  root.rotation.y += dt * S.rotSpeed;
  root.rotation.x += dt * S.rotSpeed * 0.45;
  renderer.setClearColor(0x000000, 1);
  renderer.setRenderTarget(sceneRT); renderer.render(scene, camera);
  renderer.setClearColor(0x000000, 0);
  scene.overrideMaterial = normalMat; renderer.setRenderTarget(normalRT); renderer.render(scene, camera); scene.overrideMaterial = null;
  renderer.setRenderTarget(edgeRT); renderer.render(edgePass.scene, ortho);
  renderer.setRenderTarget(cellRT); renderer.render(cellPass.scene, ortho);
  renderer.setRenderTarget(null);
  if (S.view === 'ascii') renderer.render(compositePass.scene, ortho);
  else {
    rawPass.mat.uniforms.tColor.value = S.view === 'raw color' ? sceneRT.texture : S.view === 'normals' ? normalRT.texture : edgeRT.texture;
    rawPass.mat.uniforms.srgb.value = S.view === 'raw color';
    renderer.render(rawPass.scene, ortho);
  }
  stats.update();
});
