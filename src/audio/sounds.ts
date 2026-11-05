// The game's sounds, Arcade style (chosen in the Sound style prototype): ZzFX chiptune, made in code.
// Good = rising major arpeggios, bright square; bad = falling saw, crushed noise, low buzz; neutral = single blips.
// The sound builds add the rest of the Sound event catalog here.
import type { SoundDef } from './AudioEngine';
import { arp, loopable, mix, note, zzfx as z } from './zzfx';

const sq = (f: number, rel = 0.05, vol = 0.3) => z({ f, rel, vol, shape: 5 });
const tri = (f: number, rel = 0.05, vol = 0.35) => z({ f, rel, vol, shape: 1 });
const C5 = note(3), E5 = note(7), G5 = note(10), C6 = note(15), E6 = note(19), G6 = note(22), C7 = note(27);

const fx = (render: () => Float32Array): SoundDef => ({ bus: 'effects', render, voices: 4 });

export const SOUNDS = {
  // Screen keys
  menuMove: fx(() => sq(900, 0.025, 0.15)),
  /** A choice confirmed (menus, the sound prompt). */
  menuConfirm: fx(() => arp(0.05, [sq(660, 0.04, 0.2), sq(990, 0.06, 0.2)])),
  menuBack: fx(() => arp(0.05, [sq(660, 0.04, 0.2), sq(440, 0.06, 0.2)])),
  sponsor: fx(() => arp(0.055, [tri(C6), tri(E6), tri(G6), tri(C7, 0.12)])),
  copyLink: fx(() => arp(0.04, [sq(1200, 0.03, 0.2), sq(1600, 0.05, 0.2)])),
  language: fx(() => arp(0.05, [tri(700, 0.04, 0.25), tri(820, 0.05, 0.25)])),
  // Screen changes
  glitch: fx(() => z({ f: 300, sus: 0.22, rel: 0.06, vol: 0.28, shape: 4, crush: 0.9, repeat: 0.03, jump: 700, jumpAt: 0.015, mod: 13 })),
  tvOff: fx(() => mix([z({ f: 1400, to: 60, sus: 0.2, rel: 0.12, vol: 0.28, shape: 5 })], [z({ f: 80, rel: 0.05, vol: 0.35, shape: 4 }), 0.3])),
  tvOn: fx(() => mix([z({ f: 60, rel: 0.08, vol: 0.35, shape: 4 })], [z({ f: 200, to: 1100, sus: 0.15, rel: 0.15, vol: 0.2, shape: 1 }), 0.05])),
  opponentFound: fx(() => arp(0.07, [sq(C6, 0.05), sq(E6, 0.05), sq(G6, 0.05), sq(C7, 0.18)])),
  countdownTick: fx(() => sq(440, 0.09, 0.28)),
  go: fx(() => mix([z({ f: C6, to: C6 * 1.06, sus: 0.2, rel: 0.2, vol: 0.2 })], [z({ f: E6, to: E6 * 1.06, sus: 0.2, rel: 0.2, vol: 0.18 })], [z({ f: G6, to: G6 * 1.06, sus: 0.2, rel: 0.2, vol: 0.18 })], [z({ f: 200, rel: 0.2, vol: 0.2, shape: 4 })])),
  // End screens
  scoreTick: fx(() => sq(2000, 0.012, 0.12)),
  newBest: fx(() => arp(0.07, [sq(C6), sq(E6), sq(G6), sq(C7), z({ f: note(31), sus: 0.15, rel: 0.25, vol: 0.28 })])),
  rematchProposed: fx(() => arp(0.12, [tri(660, 0.08), tri(660, 0.08)])),
  rematchAccepted: fx(() => arp(0.06, [sq(C6), sq(E6), sq(G6, 0.12)])),
  rematchDeclined: fx(() => arp(0.1, [z({ f: 300, sus: 0.05, rel: 0.07, vol: 0.3, shape: 2 }), z({ f: 200, sus: 0.06, rel: 0.12, vol: 0.3, shape: 2 })])),
  opponentLeftWin: fx(() => arp(0.08, [sq(G5), sq(C6), sq(E6), sq(G6, 0.2)])),
  /** Neutral sting: error, servers resting, opponent left outside a Match. */
  errorSting: fx(() => arp(0.12, [tri(500, 0.08, 0.28), tri(400, 0.12, 0.28)])),
  // Endings
  winEnding: fx(() => mix([z({ f: 70, sus: 0.3, rel: 0.9, vol: 0.55, shape: 4, crush: 0.7 })], [z({ f: 150, to: 30, sus: 0.2, rel: 0.6, vol: 0.35, shape: 2, crush: 0.5 })], [arp(0.09, [sq(C6), sq(E6), sq(G6), sq(C7), z({ f: note(31), sus: 0.2, rel: 0.3, vol: 0.28 })]), 0.75])),
  /** The Enemy ship looms: the low buzz swells until the TV off, which plays its own sound. */
  loseEnding: fx(() => z({ f: 50, att: 4.7, sus: 0.4, rel: 0.1, vol: 0.3, shape: 2, crush: 0.4, trem: 0.5, repeat: 0.12 })),
  peaceEnding: fx(() => mix([z({ f: 600, to: 150, att: 0.2, sus: 0.6, rel: 1.2, vol: 0.15, shape: 4, filter: -1500 })], [arp(0.35, [tri(C5, 0.3, 0.22), tri(E5, 0.3, 0.22), tri(G5, 0.3, 0.22), tri(C6, 0.8, 0.22)]), 0.4])),
  // Link effects
  signalLost: fx(() => mix([z({ f: 500, sus: 0.15, rel: 0.05, vol: 0.3, shape: 4, crush: 1, repeat: 0.02, jump: 500, jumpAt: 0.01 })], [z({ f: 600, to: 150, sus: 0.1, rel: 0.2, vol: 0.28, shape: 5 }), 0.2])),
  /** Loop while the opponent's signal is lost (RECONNECTING). */
  reconnecting: fx(() => loopable(z({ f: 300, sus: 1.95, rel: 0.05, vol: 0.12, shape: 4, crush: 0.8, trem: 0.8, repeat: 0.25 }))),
  enemyBack: fx(() => arp(0.06, [sq(E6, 0.05, 0.22), sq(G6, 0.05, 0.22), sq(C7, 0.12, 0.22)])),
  resumeTick: fx(() => sq(440, 0.09, 0.28)),
} satisfies Record<string, SoundDef>;

export type SoundId = keyof typeof SOUNDS;

/** Plays a sound by name; screens get one (silent in tests that don't listen). */
export type PlaySound = (id: SoundId) => void;
