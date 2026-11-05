// The game's sounds, Arcade style (chosen in the Sound style prototype): ZzFX chiptune, made in code.
// The sound builds add the rest of the Sound event catalog here.
import type { SoundDef } from './AudioEngine';
import { arp, zzfx } from './zzfx';

const sq = (f: number, rel = 0.05, vol = 0.3) => zzfx({ f, rel, vol, shape: 5 });

export const SOUNDS = {
  /** A choice confirmed (menus, the sound prompt). */
  menuConfirm: { bus: 'effects', render: () => arp(0.05, [sq(660, 0.04, 0.2), sq(990, 0.06, 0.2)]) },
} satisfies Record<string, SoundDef>;

export type SoundId = keyof typeof SOUNDS;
