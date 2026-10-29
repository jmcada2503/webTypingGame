import { describe, expect, it } from 'vitest';
import type { Language } from '../flow/types';
import { startPresence } from './presence';
import { FakeTimers } from './testing';

const WINDOW = 30_000;

function setup(options: { offset?: number; failBeats?: boolean; startAt?: number } = {}) {
  const timers = new FakeTimers();
  const epoch = options.startAt ?? 100 * WINDOW + 5000; // wall clock when the tab opened
  const beats: Array<{ lang: Language; window: number }> = [];
  let served = { en: 3, es: 1, total: 4 };
  let onlineCalls = 0;
  let language: Language = 'en';
  const presence = startPresence({
    language: () => language,
    timers,
    now: () => epoch + timers.now(),
    random: () => (options.offset ?? 10_000) / 25_000,
    beat: async (lang) => {
      if (options.failBeats) throw new Error('429');
      beats.push({ lang, window: Math.floor((epoch + timers.now()) / WINDOW) });
    },
    fetchOnline: async () => (onlineCalls++, served),
  });
  return {
    timers,
    presence,
    beats,
    serve: (c: typeof served) => (served = c),
    calls: () => onlineCalls,
    setLanguage: (l: Language) => (language = l),
  };
}

describe('startPresence', () => {
  it('heartbeats once in every 30 s window, never twice', async () => {
    const { timers, beats } = setup();
    await timers.advanceAsync(5 * WINDOW, 250);
    const windows = beats.map((b) => b.window);
    expect(new Set(windows).size).toBe(windows.length);
    expect(windows.length).toBeGreaterThanOrEqual(5);
  });

  it('beats at the same offset inside each window (so a tab lands in each window once)', async () => {
    const { timers, beats } = setup({ offset: 12_000, startAt: 100 * WINDOW });
    await timers.advanceAsync(3 * WINDOW, 250);
    expect(beats.map((b) => b.window)).toEqual([100, 101, 102]);
  });

  it('sends the language chosen at the time of each beat', async () => {
    const { timers, beats, setLanguage } = setup();
    await timers.advanceAsync(WINDOW, 250);
    setLanguage('es');
    await timers.advanceAsync(WINDOW, 250);
    expect(beats.map((b) => b.lang)).toEqual(['en', 'es']);
  });

  it('asks for the count at once and every 30 s, and keeps the last answer', async () => {
    const { timers, presence, calls, serve } = setup();
    expect(presence.counts()).toBeNull();
    await timers.advanceAsync(100);
    expect(presence.counts()).toEqual({ en: 3, es: 1, total: 4 });
    serve({ en: 5, es: 2, total: 7 });
    await timers.advanceAsync(WINDOW, 250);
    expect(presence.counts()).toEqual({ en: 5, es: 2, total: 7 });
    expect(calls()).toBe(2);
  });

  it('carries on when the backend refuses (resting, offline)', async () => {
    const { timers, presence } = setup({ failBeats: true });
    await timers.advanceAsync(2 * WINDOW, 250);
    expect(presence.counts()).not.toBeNull();
  });

  it('stops everything', async () => {
    const { timers, presence, beats, calls } = setup();
    await timers.advanceAsync(100);
    presence.stop();
    const before = [beats.length, calls()];
    await timers.advanceAsync(3 * WINDOW, 250);
    expect([beats.length, calls()]).toEqual(before);
  });
});
