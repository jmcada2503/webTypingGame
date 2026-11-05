import { describe, expect, test } from 'vitest';
import type { SoundRow } from '../audio/soundEditing';
import type { SoundSettings } from '../audio/soundSettings';
import { SoundPanel } from './soundPanel';

const start = (): SoundSettings => ({ master: 0.8, effects: 1, music: 0.4, keyClicks: true, muted: false });

/** A panel over settings it can change, and the log of what it reported. */
function setup() {
  let current = start();
  const changes: { settings: SoundSettings; row: SoundRow }[] = [];
  const panel = new SoundPanel(
    () => current,
    (settings, row) => {
      current = settings;
      changes.push({ settings, row });
    },
  );
  const press = (...keys: string[]) => keys.map((key) => panel.onKey({ key }));
  return { panel, press, changes, now: () => current, set: (s: SoundSettings) => (current = s) };
}

describe('opening and closing', () => {
  test('O opens the panel on the first row; other keys are left to the menu while it is closed', () => {
    const { panel, press } = setup();
    expect(press('Enter', 'j', 'h', 'q', 'm')).toEqual([false, false, false, false, false]);
    expect(panel.isOpen).toBe(false);
    expect(press('o')).toEqual([true]);
    expect(panel.isOpen).toBe(true);
    expect(panel.row).toBe('master');
  });

  test.each(['q', 'Q', 'Escape', 'o', 'O', 'Enter'])('%s closes the open panel', (key) => {
    const { panel, press } = setup();
    press('o');
    expect(press(key)).toEqual([true]);
    expect(panel.isOpen).toBe(false);
  });

  test('it opens on the first row again, whichever row it was closed on', () => {
    const { panel, press } = setup();
    press('o', 'j', 'j', 'q', 'o');
    expect(panel.row).toBe('master');
  });
});

describe('moving between rows', () => {
  test.each([['j'], ['ArrowDown'], ['Tab']])('%s goes down a row, wrapping at the bottom', (key) => {
    const { panel, press } = setup();
    press('o');
    expect(press(key)).toEqual([true]);
    expect(panel.row).toBe('effects');
    press(key, key, key);
    expect(panel.row).toBe('master');
  });

  test.each([['k'], ['ArrowUp']])('%s goes up a row, wrapping at the top', (key) => {
    const { panel, press } = setup();
    press('o', key);
    expect(panel.row).toBe('keyClicks');
    press(key);
    expect(panel.row).toBe('music');
  });

  test('every other key is taken (the menu stays put) but changes nothing', () => {
    const { panel, press, changes } = setup();
    press('o');
    expect(press('m', 's', 'x', '1', 'Backspace', ' ')).toEqual([true, true, true, true, true, true]);
    expect(panel.isOpen).toBe(true);
    expect(panel.row).toBe('master');
    expect(changes).toEqual([]);
  });
});

describe('changing a row', () => {
  test.each([['l'], ['ArrowRight']])('%s raises the picked volume by 5% and reports the new settings and the row', (key) => {
    const { press, changes, now } = setup();
    press('o', 'j', 'j'); // music
    press(key);
    expect(now().music).toBe(0.45);
    expect(changes).toEqual([{ settings: { ...start(), music: 0.45 }, row: 'music' }]);
  });

  test.each([['h'], ['ArrowLeft']])('%s lowers it', (key) => {
    const { press, now } = setup();
    press('o', key);
    expect(now().master).toBe(0.75);
  });

  test('the key clicks row flips with either left or right, every press', () => {
    const { press, now } = setup();
    press('o', 'k', 'h'); // up from master = key clicks
    expect(now().keyClicks).toBe(false);
    press('l');
    expect(now().keyClicks).toBe(true);
    press('l');
    expect(now().keyClicks).toBe(false);
    press('h');
    expect(now().keyClicks).toBe(true);
  });

  test('it edits the settings as they are now, so a quick mute made meanwhile is respected (and raising unmutes)', () => {
    const { press, now, set } = setup();
    press('o');
    set({ ...start(), muted: true });
    press('l');
    expect(now()).toEqual({ ...start(), master: 0.85, muted: false });
  });
});
