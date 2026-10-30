import { describe, expect, test } from 'vitest';
import { isFullscreenKey } from './fullscreen';

const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'repeat', boolean>> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, ...mods });

describe('the fullscreen key', () => {
  test('is a plain F, lower or upper case', () => {
    expect(isFullscreenKey(key('f'))).toBe(true);
    expect(isFullscreenKey(key('F', { shiftKey: true }))).toBe(true);
  });

  test('is not F with Ctrl, Cmd or Alt (browser shortcuts, dev keys)', () => {
    expect(isFullscreenKey(key('f', { ctrlKey: true }))).toBe(false);
    expect(isFullscreenKey(key('f', { metaKey: true }))).toBe(false);
    expect(isFullscreenKey(key('f', { altKey: true }))).toBe(false);
  });

  test('ignores a held-down key, so it does not flicker in and out', () => {
    expect(isFullscreenKey(key('f', { repeat: true }))).toBe(false);
  });

  test('is no other key', () => {
    expect(isFullscreenKey(key('g'))).toBe(false);
    expect(isFullscreenKey(key('F11'))).toBe(false);
  });
});
