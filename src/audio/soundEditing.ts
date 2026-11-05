import type { SoundSettings } from './soundSettings';

export type SoundRow = 'master' | 'effects' | 'music' | 'keyClicks';

/** The rows of the sound settings panel, top to bottom. */
export const SOUND_ROWS: readonly SoundRow[] = ['master', 'effects', 'music', 'keyClicks'];

/** One press of left / right moves a volume by this much. */
export const VOLUME_STEP = 0.05;

/** Left (-1) / right (+1) on a row. */
export function adjustSound(s: SoundSettings, row: SoundRow, dir: 1 | -1): SoundSettings {
  if (row === 'keyClicks') return { ...s, keyClicks: dir > 0 };
  // Whole percents: repeated 0.05 steps would otherwise drift (0.8 + 0.05 = 0.8500000000000001).
  return { ...s, muted: dir > 0 ? false : s.muted, [row]: Math.min(1, Math.max(0, Math.round((s[row] + dir * VOLUME_STEP) * 100) / 100)) };
}

/** Quick mute: the volumes stay as they are. */
export function toggleMute(s: SoundSettings): SoundSettings {
  return { ...s, muted: !s.muted };
}

/** The row above (-1) or below (+1), wrapping around. */
export function moveSoundRow(row: SoundRow, dir: 1 | -1): SoundRow {
  return SOUND_ROWS[(SOUND_ROWS.indexOf(row) + dir + SOUND_ROWS.length) % SOUND_ROWS.length];
}
