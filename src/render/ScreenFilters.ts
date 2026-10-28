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
  /** Darker edges and corners, 0 = off. */
  vignette: 0,
  /** Old-monitor screen bulge (0 = flat); the picture sits inside a rounded, curved frame. */
  curvature: 0,
  /** Rounded screen corners, as a fraction of the screen height. */
  cornerRadius: 0.06,
  /** Red / blue fringes (device px at the screen edges). */
  aberration: 0,
  /** Tube glass: a faint gray inside the screen so its curved shape shows on black. */
  glass: 0,
  /** Grain and brightness flicker, 0 = off. */
  noise: 0,
  flicker: 0,
};

export const anyFilterOn = () => {
  const f = SCREEN_FILTERS;
  return f.scanlines || f.glow || f.vignette > 0 || f.curvature > 0 || f.aberration > 0 || f.noise > 0 || f.flicker > 0 || f.glass > 0;
};

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
      uniform float curvature; uniform float cornerRadius; uniform float aberration;
      uniform float noise; uniform float flicker; uniform float time; uniform float glass;
      out vec4 outColor;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

      void main() {
        vec2 screenUv = gl_FragCoord.xy / res;
        // Barrel bulge: the picture shrinks toward its corners inside a curved frame.
        vec2 cc = screenUv - 0.5;
        vec2 uv = cc * (1.0 + curvature * dot(cc, cc)) + 0.5;
        // Rounded-rectangle screen edge (in picture space, so the frame curves with the bulge).
        float aspect = res.x / res.y;
        vec2 q = abs(uv - 0.5) * vec2(aspect, 1.0);
        vec2 halfSize = vec2(0.5 * aspect, 0.5);
        float rad = cornerRadius;
        vec2 dq = q - (halfSize - rad);
        float dist = length(max(dq, 0.0)) + min(max(dq.x, dq.y), 0.0) - rad;
        float inside = curvature > 0.0 ? 1.0 - smoothstep(-1.5 / res.y, 1.5 / res.y, dist) : 1.0;
        if (inside <= 0.0) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

        vec3 c;
        if (aberration > 0.0) {
          // Fringes grow toward the edges, mostly sideways.
          vec2 dir = vec2(cc.x * 2.0, cc.y * 0.6) * aberration / res;
          c = vec3(texture(tFrame, uv + dir).r, texture(tFrame, uv).g, texture(tFrame, uv - dir).b);
          c += 0.35 * vec3(0.0, 0.0, texture(tFrame, uv + dir * 1.5).b) + 0.35 * vec3(texture(tFrame, uv - dir * 1.5).r, 0.0, 0.0);
        } else {
          c = texture(tFrame, uv).rgb;
        }
        c += texture(tGlow, uv).rgb * glow;
        // Tube glass: dark gray, a touch blue-green, so the screen reads as a lit tube.
        c += glass * vec3(0.85, 1.0, 0.95);
        if (scan > 0.0) {
          // Smooth dark band once per period; brighten a little so the screen doesn't just dim.
          float y = mod(gl_FragCoord.y, scanPeriod) / scanPeriod;
          float band = 0.5 + 0.5 * cos(y * 6.2831853);
          c *= (1.0 - scan * band) * (1.0 + scan * 0.35);
        }
        if (vignette > 0.0) {
          // Darker toward the edges, strongest in the corners (old tube falloff).
          vec2 e = uv * (1.0 - uv.yx);
          float v = pow(clamp(e.x * e.y * 16.0, 0.0, 1.0), 0.6 * vignette);
          c *= mix(1.0, v, clamp(vignette, 0.0, 1.0));
        }
        if (noise > 0.0) c += (hash(gl_FragCoord.xy + fract(time) * 100.0) - 0.5) * noise;
        if (flicker > 0.0) c *= 1.0 + flicker * sin(time * 60.0) * 0.5 + flicker * (hash(vec2(floor(time * 24.0), 3.0)) - 0.5);
        outColor = vec4(max(c, 0.0) * inside, 1.0);
      }`,
      {
        tFrame: { value: this.frameRT.texture },
        tGlow: { value: this.blurA.texture },
        res: { value: new THREE.Vector2(1, 1) },
        glow: { value: 0 },
        scan: { value: 0 },
        scanPeriod: { value: 3 },
        vignette: { value: 0 },
        curvature: { value: 0 },
        cornerRadius: { value: 0.06 },
        aberration: { value: 0 },
        noise: { value: 0 },
        flicker: { value: 0 },
        time: { value: 0 },
        glass: { value: 0 },
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
    fu.curvature.value = f.curvature;
    fu.cornerRadius.value = f.cornerRadius;
    fu.aberration.value = f.aberration;
    fu.noise.value = f.noise;
    fu.flicker.value = f.flicker;
    fu.glass.value = f.glass;
    fu.time.value = (performance.now() / 1000) % 1000;
    gl.setRenderTarget(null);
    gl.render(this.final.scene, this.ortho);
  }

  dispose() {
    for (const rt of [this.frameRT, this.blurA, this.blurB]) rt.dispose();
    for (const p of [this.bright, this.blur, this.final]) p.mat.dispose();
  }
}
