import { describe, expect, test } from 'vitest';
import { AudioEngine, type SoundBank } from './AudioEngine';
import { FakeAudioContext } from './fakeAudioContext';
import { DEFAULT_SOUND_SETTINGS, type SoundSettings } from './soundSettings';

// Each test sound is marked by its first sample, so the fake can tell which one is playing.
const BLIP = 0.25;
const THEME = 0.5;
const CLICK_A = 0.125;
const CLICK_B = 0.375;
const bank: SoundBank = {
  blip: { bus: 'effects', render: () => Float32Array.of(BLIP) },
  theme: { bus: 'music', render: () => Float32Array.of(THEME) },
  click: { bus: 'keyClicks', render: () => [Float32Array.of(CLICK_A), Float32Array.of(CLICK_B)], voices: 2, pitchJitter: 0.05, gainJitterDb: 2 },
};

const FULL: SoundSettings = { master: 1, effects: 1, music: 1, keyClicks: true, muted: false };

const key = (k: string) => Object.assign(new Event('keydown'), { key: k });
const settle = () => new Promise((r) => setTimeout(r, 0));

function setup(opts: { state?: 'running' | 'suspended'; settings?: SoundSettings; random?: () => number } = {}) {
  const ctx = new FakeAudioContext(opts.state);
  const page = new EventTarget();
  const engine = new AudioEngine({ createContext: () => ctx, sounds: bank, settings: opts.settings ?? FULL, random: opts.random ?? (() => 0.5) });
  engine.listen(page);
  return { ctx, page, engine };
}

describe('audio engine', () => {
  test('audio the browser starts blocked is unlocked by a key press, not by Escape', async () => {
    const { ctx, page, engine } = setup();
    expect(engine.blocked).toBe(true);
    page.dispatchEvent(key('Escape'));
    await settle();
    expect(ctx.resumes).toBe(0);
    expect(engine.blocked).toBe(true);
    page.dispatchEvent(key('a'));
    await settle();
    expect(engine.blocked).toBe(false);
  });

  test('nothing plays while the audio is blocked', async () => {
    const { ctx, engine } = setup();
    engine.play('blip');
    expect(ctx.heard()).toEqual([]);
  });

  test('each sound plays on its bus, at the levels the settings give', async () => {
    const { ctx, page, engine } = setup({ settings: { master: 0.5, effects: 0.8, music: 0.4, keyClicks: true, muted: false } });
    page.dispatchEvent(key('a'));
    await settle();
    engine.play('blip');
    engine.play('theme');
    expect(ctx.heard().map((h) => [h.sound, h.level])).toEqual([
      [BLIP, 0.4],
      [THEME, 0.2],
    ]);
  });

  test('audio the browser allows from the start plays without a key press', () => {
    const { ctx, engine } = setup({ state: 'running' });
    expect(engine.blocked).toBe(false);
    engine.play('blip');
    expect(ctx.heard().map((h) => h.sound)).toEqual([BLIP]);
  });

  test('new settings change the level of sounds already playing', () => {
    const { ctx, engine } = setup({ state: 'running' });
    engine.play('theme');
    engine.applySettings({ ...FULL, music: 0.25 });
    expect(ctx.heard()[0].level).toBe(0.25);
    engine.applySettings({ ...FULL, music: 0.25, muted: true });
    expect(ctx.heard()[0].level).toBe(0);
  });

  test('key clicks follow the effects volume and go silent when turned off', () => {
    const { ctx, engine } = setup({ state: 'running', settings: { ...FULL, effects: 0.5 } });
    engine.play('click');
    expect(ctx.heard()[0].level).toBe(0.5);
    engine.applySettings({ ...FULL, effects: 0.5, keyClicks: false });
    expect(ctx.heard()[0].level).toBe(0);
  });

  test('a sound with a voice cap cuts its oldest voice', () => {
    const { ctx, engine } = setup({ state: 'running' });
    engine.play('click');
    engine.play('click');
    engine.play('click');
    expect(ctx.heard()).toHaveLength(2);
    expect(ctx.sources.map((s) => s.stopped)).toEqual([true, false, false]);
  });

  test('a sound with variants plays one of them each time', () => {
    const a = setup({ state: 'running', random: () => 0 });
    a.engine.play('click');
    const b = setup({ state: 'running', random: () => 0.999999 });
    b.engine.play('click');
    expect([a.ctx.heard()[0].sound, b.ctx.heard()[0].sound]).toEqual([CLICK_A, CLICK_B]);
  });

  test('each play varies pitch and level within the sound\'s range', () => {
    const low = setup({ state: 'running', random: () => 0 });
    low.engine.play('click');
    const high = setup({ state: 'running', random: () => 0.999999 });
    high.engine.play('click');
    // ±5% pitch, ±2 dB: 10^(-2/20) = 0.794, 10^(2/20) = 1.259
    expect(low.ctx.heard()[0].rate).toBeCloseTo(0.95, 4);
    expect(low.ctx.heard()[0].level).toBeCloseTo(0.794, 3);
    expect(high.ctx.heard()[0].rate).toBeCloseTo(1.05, 4);
    expect(high.ctx.heard()[0].level).toBeCloseTo(1.259, 3);
  });

  test('a loop starts at a level, follows level changes, and stops at level 0', () => {
    const { ctx, engine } = setup({ state: 'running' });
    engine.setLoop('blip', 0.5);
    expect(ctx.heard()).toEqual([{ sound: BLIP, rate: 1, level: 0.5, loop: true }]);
    engine.setLoop('blip', 0.25);
    expect(ctx.heard()).toEqual([{ sound: BLIP, rate: 1, level: 0.25, loop: true }]);
    engine.setLoop('blip', 0);
    expect(ctx.heard()).toEqual([]);
    engine.setLoop('blip', 1);
    expect(ctx.heard()).toEqual([{ sound: BLIP, rate: 1, level: 1, loop: true }]);
  });

  test('a loop asked for while the audio is blocked does not play', () => {
    const { ctx, engine } = setup();
    engine.setLoop('blip', 0.5);
    expect(ctx.heard()).toEqual([]);
  });
});
