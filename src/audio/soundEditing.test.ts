import { describe, expect, test } from 'vitest';
import { adjustSound, moveSoundRow, toggleMute } from './soundEditing';
import type { SoundSettings } from './soundSettings';

const settings = (over: Partial<SoundSettings> = {}): SoundSettings => ({ master: 0.8, effects: 1, music: 0.4, keyClicks: true, muted: false, ...over });

describe('editing a volume', () => {
  test('right raises the chosen volume by 5% and left lowers it, leaving the others alone', () => {
    expect(adjustSound(settings(), 'master', 1)).toEqual(settings({ master: 0.85 }));
    expect(adjustSound(settings(), 'music', -1)).toEqual(settings({ music: 0.35 }));
  });
});

describe('the ends of a volume', () => {
  test('a volume stops at 0% and at 100%', () => {
    expect(adjustSound(settings({ effects: 1 }), 'effects', 1).effects).toBe(1);
    expect(adjustSound(settings({ music: 0 }), 'music', -1).music).toBe(0);
    expect(adjustSound(settings({ music: 0.02 }), 'music', -1).music).toBe(0);
  });

  test('twenty steps walk the whole range with no drift', () => {
    let s = settings({ master: 0 });
    for (let i = 0; i < 20; i++) s = adjustSound(s, 'master', 1);
    expect(s.master).toBe(1);
  });
});

describe('muted and a volume is raised', () => {
  test('raising a volume while muted unmutes, so the slider never looks dead', () => {
    expect(adjustSound(settings({ muted: true }), 'master', 1)).toEqual(settings({ master: 0.85, muted: false }));
    expect(adjustSound(settings({ muted: true }), 'music', 1).muted).toBe(false);
  });

  test('lowering a volume leaves the mute alone', () => {
    expect(adjustSound(settings({ muted: true }), 'master', -1).muted).toBe(true);
  });

  test('raising counts as asking for sound even when the volume is already at its top', () => {
    expect(adjustSound(settings({ muted: true, effects: 1 }), 'effects', 1).muted).toBe(false);
  });
});

describe('the key clicks row', () => {
  test('left and right both flip the key clicks, whichever they were', () => {
    expect(adjustSound(settings({ keyClicks: false }), 'keyClicks', 1)).toEqual(settings({ keyClicks: true }));
    expect(adjustSound(settings({ keyClicks: true }), 'keyClicks', 1).keyClicks).toBe(false);
    expect(adjustSound(settings({ keyClicks: true }), 'keyClicks', -1).keyClicks).toBe(false);
    expect(adjustSound(settings({ keyClicks: false }), 'keyClicks', -1).keyClicks).toBe(true);
  });

  test('changing the key clicks does not touch the mute', () => {
    expect(adjustSound(settings({ keyClicks: false, muted: true }), 'keyClicks', 1).muted).toBe(true);
  });
});

describe('mute and the rows', () => {
  test('mute flips and keeps every volume, so unmuting brings the same mix back', () => {
    const muted = toggleMute(settings({ master: 0.55, music: 0.2 }));
    expect(muted).toEqual(settings({ master: 0.55, music: 0.2, muted: true }));
    expect(toggleMute(muted)).toEqual(settings({ master: 0.55, music: 0.2 }));
  });

  test('moving down or up the rows wraps around', () => {
    expect(moveSoundRow('master', 1)).toBe('effects');
    expect(moveSoundRow('keyClicks', 1)).toBe('master');
    expect(moveSoundRow('master', -1)).toBe('keyClicks');
    expect(moveSoundRow('music', -1)).toBe('effects');
  });
});
