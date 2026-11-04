// PROTOTYPE (sound style, throwaway): tiny sample-level synth helpers. Every sound is rendered to a Float32Array once.

export const SR = 44100;
export type Wave = 'sine' | 'square' | 'saw' | 'tri' | 'noise';
export type Buf = Float32Array;

const TAU = Math.PI * 2;

export interface ToneOpts {
  /** Start frequency (Hz) and optional end frequency (exponential slide). */
  f: number;
  f2?: number;
  dur: number;
  wave?: Wave;
  vol?: number;
  /** Attack seconds. */
  att?: number;
  /** Decay shape: env = (1 - p)^curve. 0 = flat (gate), 2 = plucky. */
  curve?: number;
  /** Pulse width for square (0..1). */
  duty?: number;
  /** FM: modulator at f * ratio, index in radians. */
  fm?: { ratio: number; index: number };
  /** Amplitude tremolo. */
  trem?: { rate: number; depth: number };
  /** Vibrato: rate Hz, depth as frequency ratio (0.02 = ±2%). */
  vib?: { rate: number; depth: number };
}

export function tone(o: ToneOpts): Buf {
  const n = Math.max(1, Math.round(o.dur * SR));
  const b = new Float32Array(n);
  const att = Math.max(o.att ?? 0.002, 1 / SR);
  const curve = o.curve ?? 2;
  const vol = o.vol ?? 0.5;
  const duty = o.duty ?? 0.5;
  let ph = 0;
  let mph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const p = i / n;
    let f = o.f2 ? o.f * (o.f2 / o.f) ** p : o.f;
    if (o.vib) f *= 1 + o.vib.depth * Math.sin(TAU * o.vib.rate * t);
    ph += f / SR;
    let v: number;
    const x = ph % 1;
    switch (o.wave ?? 'sine') {
      case 'square':
        v = x < duty ? 1 : -1;
        break;
      case 'saw':
        v = 2 * x - 1;
        break;
      case 'tri':
        v = 1 - 4 * Math.abs(x - 0.5);
        break;
      case 'noise':
        v = Math.random() * 2 - 1;
        break;
      default:
        if (o.fm) {
          mph += (f * o.fm.ratio) / SR;
          v = Math.sin(TAU * ph + o.fm.index * (1 - p) * Math.sin(TAU * mph));
        } else v = Math.sin(TAU * ph);
    }
    let env = Math.min(1, t / att) * (curve === 0 ? 1 : (1 - p) ** curve);
    if (curve === 0) env *= Math.min(1, (n - i) / (SR * 0.004)); // tiny release so gates don't pop
    if (o.trem) env *= 1 - o.trem.depth * (0.5 + 0.5 * Math.sin(TAU * o.trem.rate * t));
    b[i] = v * env * vol;
  }
  return b;
}

export interface NoiseOpts {
  dur: number;
  vol?: number;
  att?: number;
  curve?: number;
  /** Low-pass cutoff, or [from, to] sweep (Hz). */
  lp?: number | [number, number];
  /** High-pass cutoff (Hz). */
  hp?: number;
  /** Swell instead of decay: env rises (p^curve) over the duration. */
  swell?: boolean;
}

/** Filtered white noise with an envelope. */
export function noise(o: NoiseOpts): Buf {
  const n = Math.max(1, Math.round(o.dur * SR));
  const b = new Float32Array(n);
  const att = Math.max(o.att ?? 0.002, 1 / SR);
  const curve = o.curve ?? 2;
  const vol = o.vol ?? 0.5;
  let lp = 0;
  let hpPrev = 0;
  let hpOut = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const p = i / n;
    let v = Math.random() * 2 - 1;
    if (o.lp) {
      const fc = Array.isArray(o.lp) ? o.lp[0] * (o.lp[1] / o.lp[0]) ** p : o.lp;
      const a = 1 - Math.exp((-TAU * fc) / SR);
      lp += a * (v - lp);
      v = lp;
    }
    if (o.hp) {
      const rc = 1 / (TAU * o.hp);
      const a = rc / (rc + 1 / SR);
      hpOut = a * (hpOut + v - hpPrev);
      hpPrev = v;
      v = hpOut;
    }
    const shape = o.swell ? p ** curve : curve === 0 ? 1 : (1 - p) ** curve;
    b[i] = v * Math.min(1, t / att) * shape * vol * (o.lp ? 2.5 : 1);
  }
  return b;
}

export function lowpass(b: Buf, fc: number): Buf {
  const out = new Float32Array(b.length);
  const a = 1 - Math.exp((-TAU * fc) / SR);
  let y = 0;
  for (let i = 0; i < b.length; i++) out[i] = y += a * (b[i] - y);
  return out;
}

export function highpass(b: Buf, fc: number): Buf {
  const out = new Float32Array(b.length);
  const rc = 1 / (TAU * fc);
  const a = rc / (rc + 1 / SR);
  let prev = 0;
  let y = 0;
  for (let i = 0; i < b.length; i++) {
    y = a * (y + b[i] - prev);
    prev = b[i];
    out[i] = y;
  }
  return out;
}

/** Bit crush: quantize to `bits` and hold every `hold` samples (lo-fi). */
export function crush(b: Buf, bits: number, hold = 1): Buf {
  const out = new Float32Array(b.length);
  const q = 2 ** (bits - 1);
  let held = 0;
  for (let i = 0; i < b.length; i++) {
    if (i % hold === 0) held = Math.round(b[i] * q) / q;
    out[i] = held;
  }
  return out;
}

/** Soft saturation. */
export function drive(b: Buf, k: number): Buf {
  const out = new Float32Array(b.length);
  const norm = Math.tanh(k);
  for (let i = 0; i < b.length; i++) out[i] = Math.tanh(k * b[i]) / norm;
  return out;
}

/** Feedback echo; the buffer grows by `taps` delays. */
export function echo(b: Buf, delay: number, fb: number, taps = 4): Buf {
  const d = Math.round(delay * SR);
  const out = new Float32Array(b.length + d * taps);
  out.set(b);
  for (let k = 1; k <= taps; k++) {
    const g = fb ** k;
    for (let i = 0; i < b.length; i++) out[i + d * k] += b[i] * g;
  }
  return out;
}

export function gain(b: Buf, g: number): Buf {
  return b.map((v) => v * g);
}

/** Mix parts placed at times (s) with gains. */
export function mix(...parts: [Buf, number?, number?][]): Buf {
  const len = Math.max(...parts.map(([b, at = 0]) => Math.round(at * SR) + b.length));
  const out = new Float32Array(len);
  for (const [b, at = 0, g = 1] of parts) {
    const o = Math.round(at * SR);
    for (let i = 0; i < b.length; i++) out[o + i] += b[i] * g;
  }
  return out;
}

/** Notes in a row: each note's buffer starts `step` seconds after the previous. */
export function arp(step: number, notes: Buf[]): Buf {
  return mix(...notes.map((b, i): [Buf, number] => [b, i * step]));
}

/** Crossfade the ends so the buffer loops without a click. */
export function loopable(b: Buf, fade = 0.05): Buf {
  const n = Math.round(fade * SR);
  const out = b.slice(0, b.length - n);
  for (let i = 0; i < n; i++) {
    const g = i / n;
    out[i] = out[i] * g + b[b.length - n + i] * (1 - g);
  }
  return out;
}

/** Note name helper: semitones from A4. */
export const note = (semis: number) => 440 * 2 ** (semis / 12);
// A few handy pitches.
export const C5 = note(3), E5 = note(7), G5 = note(10), C6 = note(15), E6 = note(19), G6 = note(22), C7 = note(27);
