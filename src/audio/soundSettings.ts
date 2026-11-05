/** The player's sound settings, kept in `localStorage`. Volumes go from 0 to 1. */
export interface SoundSettings {
  master: number;
  effects: number;
  music: number;
  /** The clicks of matching letters and Backspace. Off doesn't silence the bad-key sounds (they warn the player). */
  keyClicks: boolean;
  /** Quick mute: silences everything without touching the volumes. */
  muted: boolean;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** A first visit: sound on, the music under the effects. */
export const DEFAULT_SOUND_SETTINGS: Readonly<SoundSettings> = { master: 0.8, effects: 1, music: 0.4, keyClicks: true, muted: false };

const KEY = 'typing-game.sound';

const volume = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);
const flag = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

/** The saved settings; a missing, broken or blocked entry gives the defaults (field by field). */
export function loadSoundSettings(storage: Store | null): SoundSettings {
  const d = DEFAULT_SOUND_SETTINGS;
  let saved: Partial<Record<keyof SoundSettings, unknown>> = {};
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(KEY) ?? '{}');
    if (parsed && typeof parsed === 'object') saved = parsed;
  } catch {
    // broken entry: defaults
  }
  return {
    master: volume(saved.master, d.master),
    effects: volume(saved.effects, d.effects),
    music: volume(saved.music, d.music),
    keyClicks: flag(saved.keyClicks, d.keyClicks),
    muted: flag(saved.muted, d.muted),
  };
}

export function saveSoundSettings(storage: Store | null, settings: SoundSettings): void {
  try {
    storage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    // storage full or blocked: the settings last for this visit only
  }
}

/** The level of each bus. Master feeds the speakers; effects and music feed master; key clicks feed effects. */
export interface BusGains {
  master: number;
  effects: number;
  music: number;
  keyClicks: number;
}

export function busGains(s: SoundSettings): BusGains {
  return { master: s.muted ? 0 : s.master, effects: s.effects, music: s.music, keyClicks: s.keyClicks ? 1 : 0 };
}
