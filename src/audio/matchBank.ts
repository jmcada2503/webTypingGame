// The Match and Practice sounds of the event catalog, Arcade style (parameters from the sound style and keystroke prototypes).
// Bad sounds are falling saws and crushed noise; good ones are rising square arpeggios. Keystrokes are the "Climb".
import type { SoundDef } from './AudioEngine';
import { arp, mix, note as semitonesFromA4, zzfx } from './zzfx';

const sq = (f: number, rel = 0.05, vol = 0.3) => zzfx({ f, rel, vol, shape: 5 });
const tri = (f: number, rel = 0.05, vol = 0.35) => zzfx({ f, rel, vol, shape: 1 });
const note = semitonesFromA4;
const [G5, B5, D6, C6, E6, G6] = [note(10), note(14), note(17), note(15), note(19), note(22)];

/** One pentatonic step per matching letter: A, B, C#, E, F# and the next octave on up. */
const PENTATONIC = [0, 2, 4, 7, 9];
const climbFrequency = (step: number) => note(PENTATONIC[step % 5] + 12 * Math.floor(step / 5));

type ClimbId = `keyClimb${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13}`;
const climb = Object.fromEntries(
  Array.from({ length: 14 }, (_, step): [string, SoundDef] => [
    `keyClimb${step}`,
    // Quiet: it plays on every letter. On the key-click bus, so the keystroke toggle mutes it.
    { bus: 'keyClicks', pitchJitter: 0.003, render: () => zzfx({ f: climbFrequency(step), rel: 0.035, vol: 0.08, shape: 5, curve: 0.6 }) },
  ]),
) as Record<ClimbId, SoundDef>;

export const MATCH_SOUNDS = {
  ...climb,
  keyBackspace: { bus: 'keyClicks', pitchJitter: 0.03, render: () => zzfx({ f: 700, to: 420, rel: 0.04, vol: 0.12, shape: 1 }) },
  // The bad-key sounds warn the player, so they stay on the effects bus: the keystroke toggle doesn't mute them.
  keyNoMatch: { bus: 'effects', pitchJitter: 0.05, render: () => [0, 1, 2].map((k) => zzfx({ f: 150 + k * 8, sus: 0.02, rel: 0.05, vol: 0.32, shape: 2, crush: 0.25 })) },
  wrongSubmit: { bus: 'effects', render: () => mix([zzfx({ f: 220, to: 160, sus: 0.06, rel: 0.06, vol: 0.35, shape: 2, crush: 0.3 })], [zzfx({ f: 150, to: 90, sus: 0.08, rel: 0.1, vol: 0.38, shape: 2, crush: 0.3 }), 0.11]) },

  /** A Word bullet leaves the Enemy ship: quiet and distant. */
  enemyFired: { bus: 'effects', render: () => zzfx({ f: 900, to: 260, sus: 0.05, rel: 0.15, vol: 0.18, shape: 2, filter: -1400 }) },
  /** A Word bullet is nearly at the Cockpit: a rising beep, the cue the eyes miss while typing. */
  closeWarning: { bus: 'effects', voices: 3, render: () => arp(0.075, [sq(700, 0.05, 0.25), sq(900, 0.05, 0.27), sq(1150, 0.07, 0.3)]) },
  lifeLost: { bus: 'effects', render: () => mix([zzfx({ f: 90, sus: 0.08, rel: 0.5, vol: 0.6, shape: 4, crush: 0.6 })], [zzfx({ f: 260, to: 40, sus: 0.1, rel: 0.35, vol: 0.45, shape: 2, crush: 0.4 })]) },
  lastLife: { bus: 'effects', voices: 1, render: () => arp(0.14, [sq(880, 0.1, 0.3), sq(620, 0.1, 0.3), sq(880, 0.1, 0.3), sq(620, 0.12, 0.3)]) },

  wordBulletDestroyed: { bus: 'effects', voices: 6, render: () => mix([zzfx({ f: 400, rel: 0.12, vol: 0.3, shape: 4, crush: 0.2 })], [arp(0.03, [sq(C6, 0.04, 0.22), sq(E6, 0.04, 0.22), sq(G6, 0.06, 0.22)]), 0.01]) },
  /** The rising pew plus a short firing blast. */
  attackFired: { bus: 'effects', render: () => mix([zzfx({ f: 380, to: 1700, sus: 0.04, rel: 0.1, vol: 0.28, shape: 5, curve: 0.5 })], [zzfx({ f: 140, rel: 0.22, vol: 0.3, shape: 4, crush: 0.4, filter: -2200 })]) },
  shotHit: { bus: 'effects', render: () => mix([zzfx({ f: 120, rel: 0.4, vol: 0.32, shape: 4, crush: 0.4, filter: -2000 })], [arp(0.045, [sq(G5, 0.05, 0.2), sq(B5, 0.05, 0.2), sq(D6, 0.1, 0.22)]), 0.05]) },
  shotDefended: { bus: 'effects', render: () => mix([zzfx({ f: 800, to: 180, sus: 0.08, rel: 0.17, vol: 0.3, shape: 2 })], [zzfx({ f: 300, rel: 0.08, vol: 0.2, shape: 4 }), 0.05]) },

  idleNudge: { bus: 'effects', render: () => arp(0.12, [tri(1200, 0.06, 0.22), tri(1200, 0.06, 0.18)]) },
  /** One per second of the PEACE IN countdown. */
  peaceTick: { bus: 'effects', voices: 2, render: () => tri(1000, 0.035, 0.22) },
} satisfies Record<string, SoundDef>;
