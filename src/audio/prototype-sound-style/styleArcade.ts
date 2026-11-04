// PROTOTYPE (sound style, throwaway). Variant A: ARCADE. ZzFX chiptune voice (square / triangle / saw, bit crush).
// Good = quick rising major arpeggios, bright square. Bad = falling saw, crushed noise, low buzz. Neutral = single triangle blips.
import type { SoundStyle } from './catalog';
import { arp, C5, C6, C7, E5, E6, G5, G6, gain, loopable, mix, note } from './synth';
import { ZZFX } from './zzfx.js';

interface Z {
  f: number;
  vol?: number;
  att?: number;
  sus?: number;
  rel?: number;
  decay?: number;
  /** 0 sin, 1 tri, 2 saw, 3 tan, 4 noise, 5 square. */
  shape?: number;
  curve?: number;
  /** End frequency (Hz) of a linear slide over the sound. */
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
  /** Hz; positive = high-pass, negative = low-pass. */
  filter?: number;
}

/** One ZzFX sound. `to` is turned into ZzFX's slide units (Hz change = slide * 500 * seconds). */
function z(o: Z): Float32Array {
  const att = o.att ?? 0;
  const sus = o.sus ?? 0;
  const rel = o.rel ?? 0.1;
  const decay = o.decay ?? 0;
  const total = att + sus + rel + decay;
  const slide = o.to !== undefined ? (o.to - o.f) / (500 * total) : 0;
  return ZZFX.buildSamples(
    o.vol ?? 0.4, 0, o.f, att, sus, rel, o.shape ?? 5, o.curve ?? 1, slide, 0, o.jump ?? 0, o.jumpAt ?? 0, o.repeat ?? 0,
    o.noise ?? 0, o.mod ?? 0, o.crush ?? 0, o.delay ?? 0, o.susVol ?? 1, decay, o.trem ?? 0, o.filter ?? 0,
  );
}

const sq = (f: number, rel = 0.05, vol = 0.3) => z({ f, rel, vol, shape: 5 });
const tri = (f: number, rel = 0.05, vol = 0.35) => z({ f, rel, vol, shape: 1 });
const variants = (n: number, make: (k: number) => Float32Array) => Array.from({ length: n }, (_, k) => make(k));

export const arcade: SoundStyle = {
  key: 'A',
  name: 'Arcade',
  idea: 'ZzFX chiptune: square/triangle blips, crushed noise. Good = rising major arpeggios; bad = falling saw + crunch.',
  sounds: {
    keyMatch: () => variants(5, (k) => z({ f: 1500 + k * 90, rel: 0.018, vol: 0.18, shape: 5, curve: 0.6 })),
    keyNoMatch: () => variants(3, (k) => z({ f: 150 + k * 8, sus: 0.02, rel: 0.05, vol: 0.32, shape: 2, crush: 0.25 })),
    keyBackspace: () => z({ f: 900, to: 550, rel: 0.035, vol: 0.18, shape: 1 }),
    wrongSubmit: () => mix([z({ f: 220, to: 160, sus: 0.06, rel: 0.06, vol: 0.35, shape: 2, crush: 0.3 })], [z({ f: 150, to: 90, sus: 0.08, rel: 0.1, vol: 0.38, shape: 2, crush: 0.3 }), 0.11]),
    enemyFired: () => z({ f: 900, to: 260, sus: 0.05, rel: 0.15, vol: 0.18, shape: 2, filter: -1400 }),
    closeWarning: () => arp(0.075, [sq(700, 0.05, 0.25), sq(900, 0.05, 0.27), sq(1150, 0.07, 0.3)]),
    lifeLost: () => mix([z({ f: 90, sus: 0.08, rel: 0.5, vol: 0.6, shape: 4, crush: 0.6 })], [z({ f: 260, to: 40, sus: 0.1, rel: 0.35, vol: 0.45, shape: 2, crush: 0.4 })]),
    lastLife: () => arp(0.14, [sq(880, 0.1, 0.3), sq(620, 0.1, 0.3), sq(880, 0.1, 0.3), sq(620, 0.12, 0.3)]),
    damageHum: () => loopable(mix([z({ f: 55, sus: 1.6, rel: 0.05, vol: 0.12, shape: 2, crush: 0.5 })], ...Array.from({ length: 6 }, (_, i): [Float32Array, number] => [z({ f: 400 + Math.random() * 800, rel: 0.02, vol: 0.12, shape: 4 }), 0.1 + i * 0.25 + Math.random() * 0.1]))),
    wordBulletDestroyed: () => mix([z({ f: 400, rel: 0.12, vol: 0.3, shape: 4, crush: 0.2 })], [arp(0.03, [sq(C6, 0.04, 0.22), sq(E6, 0.04, 0.22), sq(G6, 0.06, 0.22)]), 0.01]),
    attackFired: () => z({ f: 380, to: 1700, sus: 0.04, rel: 0.1, vol: 0.28, shape: 5, curve: 0.5 }),
    shotHit: () => mix([z({ f: 120, rel: 0.4, vol: 0.32, shape: 4, crush: 0.4, filter: -2000 })], [arp(0.045, [sq(G5, 0.05, 0.2), sq(note(14), 0.05, 0.2), sq(note(17), 0.1, 0.22)]), 0.05]),
    shotDefended: () => mix([z({ f: 800, to: 180, sus: 0.08, rel: 0.17, vol: 0.3, shape: 2 })], [z({ f: 300, rel: 0.08, vol: 0.2, shape: 4 }), 0.05]),
    idleNudge: () => arp(0.12, [tri(1200, 0.06, 0.22), tri(1200, 0.06, 0.18)]),
    peaceTick: () => tri(1000, 0.035, 0.22),
    menuMove: () => sq(900, 0.025, 0.15),
    menuConfirm: () => arp(0.05, [sq(660, 0.04, 0.2), sq(990, 0.06, 0.2)]),
    menuBack: () => arp(0.05, [sq(660, 0.04, 0.2), sq(440, 0.06, 0.2)]),
    sponsor: () => arp(0.055, [tri(C6), tri(E6), tri(G6), tri(C7, 0.12)]),
    copyLink: () => arp(0.04, [sq(1200, 0.03, 0.2), sq(1600, 0.05, 0.2)]),
    language: () => arp(0.05, [tri(700, 0.04, 0.25), tri(820, 0.05, 0.25)]),
    glitch: () => z({ f: 300, sus: 0.22, rel: 0.06, vol: 0.28, shape: 4, crush: 0.9, repeat: 0.03, jump: 700, jumpAt: 0.015, mod: 13 }),
    tvOff: () => mix([z({ f: 1400, to: 60, sus: 0.2, rel: 0.12, vol: 0.28, shape: 5 })], [z({ f: 80, rel: 0.05, vol: 0.35, shape: 4 }), 0.3]),
    tvOn: () => mix([z({ f: 60, rel: 0.08, vol: 0.35, shape: 4 })], [z({ f: 200, to: 1100, sus: 0.15, rel: 0.15, vol: 0.2, shape: 1 }), 0.05]),
    opponentFound: () => arp(0.07, [sq(C6, 0.05), sq(E6, 0.05), sq(G6, 0.05), sq(C7, 0.18)]),
    countdownTick: () => sq(440, 0.09, 0.28),
    go: () => mix([z({ f: C6, to: C6 * 1.06, sus: 0.2, rel: 0.2, vol: 0.2, shape: 5 })], [z({ f: E6, to: E6 * 1.06, sus: 0.2, rel: 0.2, vol: 0.18, shape: 5 })], [z({ f: G6, to: G6 * 1.06, sus: 0.2, rel: 0.2, vol: 0.18, shape: 5 })], [z({ f: 200, rel: 0.2, vol: 0.2, shape: 4 })]),
    scoreTick: () => sq(2000, 0.012, 0.12),
    newBest: () => arp(0.07, [sq(C6), sq(E6), sq(G6), sq(C7), z({ f: note(31), sus: 0.15, rel: 0.25, vol: 0.28 })]),
    rematchProposed: () => arp(0.12, [tri(660, 0.08), tri(660, 0.08)]),
    rematchAccepted: () => arp(0.06, [sq(C6), sq(E6), sq(G6, 0.12)]),
    rematchDeclined: () => arp(0.1, [z({ f: 300, sus: 0.05, rel: 0.07, vol: 0.3, shape: 2 }), z({ f: 200, sus: 0.06, rel: 0.12, vol: 0.3, shape: 2 })]),
    opponentLeftWin: () => arp(0.08, [sq(G5), sq(C6), sq(E6), sq(G6, 0.2)]),
    errorSting: () => arp(0.12, [tri(500, 0.08, 0.28), tri(400, 0.12, 0.28)]),
    winEnding: () => mix([z({ f: 70, sus: 0.3, rel: 0.9, vol: 0.55, shape: 4, crush: 0.7 })], [z({ f: 150, to: 30, sus: 0.2, rel: 0.6, vol: 0.35, shape: 2, crush: 0.5 })], [arp(0.09, [sq(C6), sq(E6), sq(G6), sq(C7), z({ f: note(31), sus: 0.2, rel: 0.3, vol: 0.28 })]), 0.75]),
    loseEnding: () =>
      mix(
        // the Enemy ship looms: low buzz swelling
        [z({ f: 50, att: 2.5, sus: 0.9, rel: 0.1, vol: 0.25, shape: 2, crush: 0.4, trem: 0.5, repeat: 0.12 })],
        // it rushes over: rising then falling noise whoosh
        [z({ f: 200, to: 900, att: 0.3, sus: 0.1, rel: 0.4, vol: 0.4, shape: 4 }), 3.4],
        // sad falling notes
        [arp(0.22, [sq(note(10), 0.18, 0.22), sq(note(8), 0.18, 0.22), sq(note(6), 0.18, 0.22), z({ f: note(3), to: note(-2), sus: 0.2, rel: 0.4, vol: 0.24, shape: 5 })]), 4.0],
      ),
    peaceEnding: () => mix([z({ f: 600, to: 150, att: 0.2, sus: 0.6, rel: 1.2, vol: 0.15, shape: 4, filter: -1500 })], [arp(0.35, [tri(C5, 0.3, 0.22), tri(E5, 0.3, 0.22), tri(G5, 0.3, 0.22), tri(C6, 0.8, 0.22)]), 0.4]),
    signalLost: () => mix([z({ f: 500, sus: 0.15, rel: 0.05, vol: 0.3, shape: 4, crush: 1, repeat: 0.02, jump: 500, jumpAt: 0.01 })], [z({ f: 600, to: 150, sus: 0.1, rel: 0.2, vol: 0.28, shape: 5 }), 0.2]),
    reconnecting: () => loopable(gain(z({ f: 300, sus: 1.95, rel: 0.05, vol: 0.12, shape: 4, crush: 0.8, trem: 0.8, repeat: 0.25 }), 1)),
    enemyBack: () => arp(0.06, [sq(E6, 0.05, 0.22), sq(G6, 0.05, 0.22), sq(C7, 0.12, 0.22)]),
    resumeTick: () => sq(440, 0.09, 0.28),
  },
};
