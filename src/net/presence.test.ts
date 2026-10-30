import { describe, expect, it } from 'vitest';
import type { Language } from '../flow/types';
import { startPresence, type OnlineReport } from './presence';
import { FakeTimers } from './testing';

const WINDOW = 60_000;

function setup(options: { offset?: number; failBeats?: boolean; startAt?: number; coin?: number; served?: OnlineReport } = {}) {
  const timers = new FakeTimers();
  const epoch = options.startAt ?? 100 * WINDOW + 5000; // wall clock when the tab opened
  const beats: Array<{ lang: Language; window: number }> = [];
  let served: OnlineReport = options.served ?? { en: 3, es: 1, total: 4, sample: 1 };
  let onlineCalls = 0;
  let language: Language = 'en';
  const presence = startPresence({
    language: () => language,
    timers,
    now: () => epoch + timers.now(),
    random: () => ((options.offset ?? 10_000) - 2000) / 53_000,
    coin: () => options.coin ?? 0.5,
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
    serve: (c: OnlineReport) => (served = c),
    calls: () => onlineCalls,
    setLanguage: (l: Language) => (language = l),
  };
}

describe('startPresence', () => {
  it('heartbeats once in every 60 s window, never twice', async () => {
    const { timers, beats } = setup();
    await timers.advanceAsync(5 * WINDOW, 500);
    const windows = beats.map((b) => b.window);
    expect(new Set(windows).size).toBe(windows.length);
    expect(windows.length).toBeGreaterThanOrEqual(5);
  });

  it('beats at the same offset inside each window', async () => {
    const { timers, beats } = setup({ offset: 12_000, startAt: 100 * WINDOW });
    await timers.advanceAsync(3 * WINDOW, 500);
    expect(beats.map((b) => b.window)).toEqual([100, 101, 102]);
  });

  it('sends the language chosen at the time of each beat', async () => {
    const { timers, beats, setLanguage } = setup({ offset: 12_000, startAt: 100 * WINDOW });
    await timers.advanceAsync(WINDOW, 500);
    setLanguage('es');
    await timers.advanceAsync(WINDOW, 500);
    expect(beats.map((b) => b.lang)).toEqual(['en', 'es']);
  });

  it('asks for the count at once and every 30 s, and keeps the last answer (without the sampling rate)', async () => {
    const { timers, presence, calls, serve } = setup();
    expect(presence.counts()).toBeNull();
    await timers.advanceAsync(100);
    expect(presence.counts()).toEqual({ en: 3, es: 1, total: 4 });
    serve({ en: 5, es: 2, total: 7, sample: 1 });
    await timers.advanceAsync(30_000, 500);
    expect(presence.counts()).toEqual({ en: 5, es: 2, total: 7 });
    expect(calls()).toBe(2);
  });

  it('carries on when the backend refuses (resting, offline)', async () => {
    const { timers, presence } = setup({ failBeats: true });
    await timers.advanceAsync(2 * WINDOW, 500);
    expect(presence.counts()).not.toBeNull();
  });

  it('stops everything', async () => {
    const { timers, presence, beats, calls } = setup();
    await timers.advanceAsync(100);
    presence.stop();
    const before = [beats.length, calls()];
    await timers.advanceAsync(3 * WINDOW, 500);
    expect([beats.length, calls()]).toEqual(before);
  });
});

describe('sampling', () => {
  it('when the backend asks for a share, a tab only beats in windows where its coin lands under it', async () => {
    const served = { en: 200, es: 0, total: 200, sample: 0.25 };
    const lucky = setup({ coin: 0.2, offset: 12_000, startAt: 100 * WINDOW, served });
    const unlucky = setup({ coin: 0.3, offset: 12_000, startAt: 100 * WINDOW, served });
    await lucky.timers.advanceAsync(3 * WINDOW, 500);
    await unlucky.timers.advanceAsync(3 * WINDOW, 500);
    expect(lucky.beats).toHaveLength(3);
    expect(unlucky.beats).toHaveLength(0);
  });

  it('every tab beats while the share is 1, and a broken share counts as 1', async () => {
    const t = setup({ coin: 0.99, offset: 12_000, startAt: 100 * WINDOW, served: { en: 3, es: 1, total: 4, sample: 7 } });
    await t.timers.advanceAsync(2 * WINDOW, 500);
    expect(t.beats).toHaveLength(2);
  });

  it('a tab population sampled at 1/4 sends about a quarter of the heartbeats', async () => {
    let seed = 1;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let sent = 0;
    const tabs = 400;
    for (let i = 0; i < tabs; i++) {
      const timers = new FakeTimers();
      startPresence({
        language: () => 'en',
        timers,
        now: () => 100 * WINDOW + timers.now(),
        random: () => 0.2,
        coin: rng,
        beat: async () => void sent++,
        fetchOnline: async () => ({ en: 200, es: 0, total: 200, sample: 0.25 }),
      });
      await timers.advanceAsync(WINDOW, 5000);
    }
    expect(sent / tabs).toBeGreaterThan(0.18);
    expect(sent / tabs).toBeLessThan(0.32);
  });
});
