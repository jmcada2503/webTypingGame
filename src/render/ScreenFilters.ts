import * as THREE from 'three';

/** Live-tunable from the sandbox panel ("Juice: Screen filters"). */
export const SCREEN_FILTERS = {
  /** Old-monitor scanlines: dark horizontal bands every `scanPeriod` device pixels. */
  scanlines: false,
  scanStrength: 0.35,
  scanPeriod: 3,
  /** Glow (bloom) around bright areas. */
  glow: false,
  glowStrength: 0.9,
  /** Blur spread, in half-resolution texels. */
  glowRadius: 1.5,
  /** Brightness (0..1) a pixel needs before it glows. */
  glowThreshold: 0.25,
  /** Darker corners, 0 = off. */
  vignette: 0,
};

export const anyFilterOn = () => SCREEN_FILTERS.scanlines || SCREEN_FILTERS.glow || SCREEN_FILTERS.vignette > 0;

const VERT = 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }';

/**
 * Screen filters drawn over the finished frame (ASCII + text + overlay): the frame is rendered
 * into `frameRT`, then a bright pass + two-pass blur at half resolution builds the glow, and the
 * final pass adds glow, scanlines and vignette on the way to the screen.
 */
export class ScreenFilters {
  readonly frameRT = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true });
  private readonly blurA = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  private readonly blurB = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  private readonly bright: { scene: THREE.Scene; mat: THREE.ShaderMaterial };
  private readonly blur: { scene: THREE.Scene; mat: THREE.ShaderMaterial };
  private readonly final: { scene: THREE.Scene; mat: THREE.ShaderMaterial };

  constructor(
    private readonly quad: THREE.PlaneGeometry,
    private readonly ortho: THREE.Camera,
  ) {
    for (const rt of [this.blurA, this.blurB]) rt.texture.minFilter = rt.texture.magFilter = THREE.LinearFilter;

    this.bright = this.pass(
      /* glsl */ `
      precision highp float;
      uniform sampler2D tFrame; uniform vec2 res; uniform float threshold;
      out vec4 outColor;
      void main() {
        vec3 c = texture(tFrame, gl_FragCoord.xy / res).rgb;
        float L = max(c.r, max(c.g, c.b));
        outColor = vec4(c * smoothstep(threshold, threshold + 0.15, L), 1.0);
      }`,
      { tFrame: { value: this.frameRT.texture }, res: { value: new THREE.Vector2(1, 1) }, threshold: { value: 0.25 } },
    );

    this.blur = this.pass(
      /* glsl */ `
      precision highp float;
      uniform sampler2D tSrc; uniform vec2 res; uniform vec2 dir;
      out vec4 outColor;
      void main() {
        vec2 uv = gl_FragCoord.xy / res;
        vec2 o = dir / res;
        vec3 s = texture(tSrc, uv).rgb * 0.227;
        s += (texture(tSrc, uv + o * 1.38).rgb + texture(tSrc, uv - o * 1.38).rgb) * 0.316;
        s += (texture(tSrc, uv + o * 3.23).rgb + texture(tSrc, uv - o * 3.23).rgb) * 0.070;
        outColor = vec4(s, 1.0);
      }`,
      { tSrc: { value: null }, res: { value: new THREE.Vector2(1, 1) }, dir: { value: new THREE.Vector2(1, 0) } },
    );

    this.final = this.pass(
      /* glsl */ `
      precision highp float;
      uniform sampler2D tFrame; uniform sampler2D tGlow; uniform vec2 res;
      uniform float glow; uniform float scan; uniform float scanPeriod; uniform float vignette;
      out vec4 outColor;
      void main() {
        vec2 uv = gl_FragCoord.xy / res;
        vec3 c = texture(tFrame, uv).rgb;
        c += texture(tGlow, uv).rgb * glow;
        if (scan > 0.0) {
          // Smooth dark band once per period; brighten a little so the screen doesn't just dim.
          float y = mod(gl_FragCoord.y, scanPeriod) / scanPeriod;
          float band = 0.5 + 0.5 * cos(y * 6.2831853);
          c *= (1.0 - scan * band) * (1.0 + scan * 0.35);
        }
        if (vignette > 0.0) {
          vec2 d = uv - 0.5;
          c *= clamp(1.0 - vignette * dot(d, d) * 2.5, 0.0, 1.0);
        }
        outColor = vec4(c, 1.0);
      }`,
      {
        tFrame: { value: this.frameRT.texture },
        tGlow: { value: this.blurA.texture },
        res: { value: new THREE.Vector2(1, 1) },
        glow: { value: 0 },
        scan: { value: 0 },
        scanPeriod: { value: 3 },
        vignette: { value: 0 },
      },
    );
  }

  private pass(frag: string, uniforms: Record<string, THREE.IUniform>) {
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: VERT,
      fragmentShader: frag,
    });
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(this.quad, mat));
    return { scene, mat };
  }

  resize(w: number, h: number) {
    this.frameRT.setSize(w, h);
    const hw = Math.max(1, Math.floor(w / 2));
    const hh = Math.max(1, Math.floor(h / 2));
    this.blurA.setSize(hw, hh);
    this.blurB.setSize(hw, hh);
    this.bright.mat.uniforms.res.value.set(hw, hh);
    this.blur.mat.uniforms.res.value.set(hw, hh);
    this.final.mat.uniforms.res.value.set(w, h);
  }

  /** Draw `frameRT` to the screen with the filters on. */
  apply(gl: THREE.WebGLRenderer) {
    const f = SCREEN_FILTERS;
    const fu = this.final.mat.uniforms;
    if (f.glow) {
      this.bright.mat.uniforms.threshold.value = f.glowThreshold;
      gl.setRenderTarget(this.blurA);
      gl.render(this.bright.scene, this.ortho);
      const bu = this.blur.mat.uniforms;
      for (let i = 0; i < 2; i++) {
        bu.tSrc.value = this.blurA.texture;
        bu.dir.value.set(f.glowRadius, 0);
        gl.setRenderTarget(this.blurB);
        gl.render(this.blur.scene, this.ortho);
        bu.tSrc.value = this.blurB.texture;
        bu.dir.value.set(0, f.glowRadius);
        gl.setRenderTarget(this.blurA);
        gl.render(this.blur.scene, this.ortho);
      }
    }
    fu.glow.value = f.glow ? f.glowStrength : 0;
    fu.scan.value = f.scanlines ? f.scanStrength : 0;
    fu.scanPeriod.value = Math.max(2, f.scanPeriod);
    fu.vignette.value = f.vignette;
    gl.setRenderTarget(null);
    gl.render(this.final.scene, this.ortho);
  }

  dispose() {
    for (const rt of [this.frameRT, this.blurA, this.blurB]) rt.dispose();
    for (const p of [this.bright, this.blur, this.final]) p.mat.dispose();
  }
}
