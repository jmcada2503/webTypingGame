/*
  The sound generator from ZzFX v1.4.0 by Frank Force (https://github.com/KilledByAPixel/ZzFX), typed, with
  named options and no playback of its own (the AudioEngine plays the samples).

  ZzFX MIT License

  Copyright (c) 2019 - Frank Force

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.
*/
import { SAMPLE_RATE } from './AudioEngine';

/** One ZzFX sound. Times in seconds, frequencies in Hz. */
export interface Zzfx {
  /** Start frequency. */
  f: number;
  vol?: number;
  att?: number;
  sus?: number;
  rel?: number;
  decay?: number;
  /** 0 sine, 1 triangle, 2 saw, 3 tan, 4 noise, 5 square (default). */
  shape?: number;
  curve?: number;
  /** End frequency of a linear slide over the whole sound. */
  to?: number;
  jump?: number;
  jumpAt?: number;
  repeat?: number;
  noise?: number;
  mod?: number;
  crush?: number;
  delay?: number;
  susVol?: number;
  trem?: number;
  /** Positive = high-pass, negative = low-pass, at that many Hz. */
  filter?: number;
}

/** The samples of one ZzFX sound (`to` becomes ZzFX's slide: Hz change = slide × 500 × seconds). */
export function zzfx(o: Zzfx): Float32Array {
  const att = o.att ?? 0;
  const sus = o.sus ?? 0;
  const rel = o.rel ?? 0.1;
  const decay = o.decay ?? 0;
  const slide = o.to !== undefined ? (o.to - o.f) / (500 * (att + sus + rel + decay)) : 0;
  return buildSamples(o.vol ?? 0.4, o.f, att, sus, rel, o.shape ?? 5, o.curve ?? 1, slide, 0, o.jump ?? 0, o.jumpAt ?? 0, o.repeat ?? 0, o.noise ?? 0, o.mod ?? 0, o.crush ?? 0, o.delay ?? 0, o.susVol ?? 1, decay, o.trem ?? 0, o.filter ?? 0);
}

// ZzFX's buildSamples, unchanged but for types and no pitch randomness (the engine varies each play instead).
function buildSamples(
  volume: number,
  frequency: number,
  attack: number,
  sustain: number,
  release: number,
  shape: number,
  shapeCurve: number,
  slide: number,
  deltaSlide: number,
  pitchJump: number,
  pitchJumpTime: number,
  repeatTime: number,
  noise: number,
  modulation: number,
  bitCrush: number,
  delay: number,
  sustainVolume: number,
  decay: number,
  tremolo: number,
  filter: number,
): Float32Array {
  const sampleRate = SAMPLE_RATE;
  const PI2 = Math.PI * 2;
  const abs = Math.abs;
  const sign = (v: number) => (v < 0 ? -1 : 1);
  const startSlide = (slide *= (500 * PI2) / sampleRate / sampleRate);
  let startFrequency = (frequency *= PI2 / sampleRate);
  let modOffset = 0;
  let repeat = 0;
  let crush = 0;
  let jump = 1;
  let t = 0;
  let i = 0;
  let s = 0;
  let f: number;

  // biquad LP/HP filter
  const quality = 2;
  const w = (PI2 * abs(filter) * 2) / sampleRate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / 2 / quality;
  const a0 = 1 + alpha;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  const b0 = (1 + sign(filter) * cos) / 2 / a0;
  const b1 = -(sign(filter) + cos) / a0;
  const b2 = b0;
  let x2 = 0;
  let x1 = 0;
  let y2 = 0;
  let y1 = 0;

  const minAttack = 9; // prevent pop if attack is 0
  attack = attack * sampleRate || minAttack;
  decay *= sampleRate;
  sustain *= sampleRate;
  release *= sampleRate;
  delay *= sampleRate;
  deltaSlide *= (500 * PI2) / sampleRate ** 3;
  modulation *= PI2 / sampleRate;
  pitchJump *= PI2 / sampleRate;
  pitchJumpTime *= sampleRate;
  repeatTime = (repeatTime * sampleRate) | 0;

  const length = (attack + decay + sustain + release + delay) | 0;
  const b = new Float32Array(length > 0 ? length : 0);

  for (; i < length; b[i++] = s * volume) {
    if (!(++crush % ((bitCrush * 100) | 0))) {
      s = shape
        ? shape > 1
          ? shape > 2
            ? shape > 3
              ? shape > 4
                ? (t / PI2) % 1 < shapeCurve / 2
                  ? 1
                  : -1 // 5 square duty
                : Math.sin(t ** 3) // 4 noise
              : Math.max(Math.min(Math.tan(t), 1), -1) // 3 tan
            : 1 - (((((2 * t) / PI2) % 2) + 2) % 2) // 2 saw
          : 1 - 4 * abs(Math.round(t / PI2) - t / PI2) // 1 triangle
        : Math.sin(t); // 0 sine

      s =
        (repeatTime ? 1 - tremolo + tremolo * Math.sin((PI2 * i) / repeatTime) : 1) * // tremolo
        (shape > 4 ? s : sign(s) * abs(s) ** shapeCurve) * // shape curve
        (i < attack
          ? i / attack // attack
          : i < attack + decay
            ? 1 - ((i - attack) / decay) * (1 - sustainVolume) // decay falloff
            : i < attack + decay + sustain
              ? sustainVolume // sustain volume
              : i < length - delay
                ? ((length - i - delay) / release) * sustainVolume // release falloff
                : 0); // post release

      s = delay ? s / 2 + (delay > i ? 0 : ((i < length - delay ? 1 : (length - i) / delay) * b[(i - delay) | 0]) / 2 / volume) : s; // delay

      if (filter) s = y1 = b2 * x2 + b1 * (x2 = x1) + b0 * (x1 = s) - a2 * y2 - a1 * (y2 = y1); // filter
    }

    f = (frequency += slide += deltaSlide) * Math.cos(modulation * modOffset++); // frequency, modulation
    t += f + f * noise * (((i * i * PI2) % 2) - 1); // noise

    if (jump && ++jump > pitchJumpTime) {
      frequency += pitchJump; // pitch jump
      startFrequency += pitchJump;
      jump = 0;
    }

    if (repeatTime && !(++repeat % repeatTime)) {
      frequency = startFrequency; // repeat
      slide = startSlide;
      jump ||= 1;
    }
  }
  return b;
}

/** Sounds laid over each other: `[samples, start seconds, gain]`. */
export function mix(...parts: [Float32Array, number?, number?][]): Float32Array {
  const len = Math.max(...parts.map(([b, at = 0]) => Math.round(at * SAMPLE_RATE) + b.length));
  const out = new Float32Array(len);
  for (const [b, at = 0, g = 1] of parts) {
    const o = Math.round(at * SAMPLE_RATE);
    for (let i = 0; i < b.length; i++) out[o + i] += b[i] * g;
  }
  return out;
}

/** Sounds one after another, `step` seconds apart. */
export const arp = (step: number, notes: Float32Array[]) => mix(...notes.map((b, i): [Float32Array, number] => [b, i * step]));
