import { describe, expect, test } from 'vitest';
import { busGains, loadSoundSettings, saveSoundSettings } from './soundSettings';

/** A `localStorage` stand-in. */
const memoryStorage = (entries: Record<string, string> = {}) => {
  const data = new Map(Object.entries(entries));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
};

describe('sound settings', () => {
  test('a first visit has sound on: master 80%, effects 80%, music 40%, key clicks on', () => {
    expect(loadSoundSettings(memoryStorage())).toEqual({ master: 0.8, effects: 0.8, music: 0.4, keyClicks: true, muted: false });
  });

  test('saved settings come back on the next visit', () => {
    const storage = memoryStorage();
    saveSoundSettings(storage, { master: 0.55, effects: 0.3, music: 0, keyClicks: false, muted: true });
    expect(loadSoundSettings(storage)).toEqual({ master: 0.55, effects: 0.3, music: 0, keyClicks: false, muted: true });
  });

  test('a broken entry falls back to the defaults', () => {
    expect(loadSoundSettings(memoryStorage({ 'typing-game.sound': '{not json' }))).toEqual({ master: 0.8, effects: 0.8, music: 0.4, keyClicks: true, muted: false });
  });

  test('each bad or missing field falls back on its own; volumes are kept between 0 and 1', () => {
    const stored = JSON.stringify({ master: 3, effects: -1, music: 'loud', muted: true });
    expect(loadSoundSettings(memoryStorage({ 'typing-game.sound': stored }))).toEqual({ master: 1, effects: 0, music: 0.4, keyClicks: true, muted: true });
  });

  test('no storage (blocked by the browser) plays with the defaults and saving does nothing', () => {
    expect(() => saveSoundSettings(null, { master: 0.1, effects: 1, music: 1, keyClicks: true, muted: false })).not.toThrow();
    expect(loadSoundSettings(null)).toEqual({ master: 0.8, effects: 0.8, music: 0.4, keyClicks: true, muted: false });
  });

  test('the volumes set the bus levels; key clicks sit inside the effects', () => {
    expect(busGains({ master: 0.8, effects: 0.5, music: 0.4, keyClicks: true, muted: false })).toEqual({ master: 0.8, effects: 0.5, music: 0.4, keyClicks: 1 });
  });

  test('key clicks off silences only the key-click bus', () => {
    expect(busGains({ master: 0.8, effects: 1, music: 0.4, keyClicks: false, muted: false })).toEqual({ master: 0.8, effects: 1, music: 0.4, keyClicks: 0 });
  });

  test('muted silences everything but keeps the volumes', () => {
    expect(busGains({ master: 0.8, effects: 1, music: 0.4, keyClicks: true, muted: true })).toEqual({ master: 0, effects: 1, music: 0.4, keyClicks: 1 });
  });
});
