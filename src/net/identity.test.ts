import { describe, expect, it } from 'vitest';
import { listVersion, playerId } from './identity';

function memory() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
}

describe('playerId', () => {
  it('makes an id the backend accepts and keeps it', () => {
    const storage = memory();
    const id = playerId(storage);
    expect(id).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(playerId(storage)).toBe(id);
  });

  it('replaces a stored id the backend would refuse', () => {
    const storage = memory();
    storage.setItem('typing-game.player-id', 'bad id!');
    expect(playerId(storage)).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  });

  it('still works when storage throws (blocked)', () => {
    const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(playerId(blocked)).toMatch(/^[0-9a-f]{32}$/);
    expect(playerId(null)).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('listVersion', () => {
  const list = { short: ['sol', 'mar'], medium: ['casas'], long: ['estrellas'] };

  it('is stable, fits the backend format and carries the picker version', () => {
    expect(listVersion(list)).toBe(listVersion({ ...list }));
    expect(listVersion(list)).toMatch(/^[0-9a-f]{8}-p\d+$/);
  });

  it('changes when a word, the order or the tier changes', () => {
    const v = listVersion(list);
    expect(listVersion({ ...list, short: ['sol', 'mal'] })).not.toBe(v);
    expect(listVersion({ ...list, short: ['mar', 'sol'] })).not.toBe(v);
    expect(listVersion({ short: ['sol'], medium: ['mar', 'casas'], long: ['estrellas'] })).not.toBe(v);
  });
});
