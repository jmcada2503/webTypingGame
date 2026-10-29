import { describe, expect, it } from 'vitest';
import { checkFreshness } from './freshness';

const MINE = { en: 'aaaa-p1', es: 'bbbb-p1' };
const serving = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

describe('checkFreshness', () => {
  it('fresh when the deployed build has the same word lists', async () => {
    expect(await checkFreshness(MINE, serving(MINE))).toBe('fresh');
  });

  it('stale when either language changed (or the picker version)', async () => {
    expect(await checkFreshness(MINE, serving({ ...MINE, es: 'cccc-p1' }))).toBe('stale');
    expect(await checkFreshness(MINE, serving({ ...MINE, en: 'aaaa-p2' }))).toBe('stale');
  });

  it('unknown when there is no file, a broken one, or no network: never blocks the player', async () => {
    expect(await checkFreshness(MINE, serving({}, 404))).toBe('unknown');
    expect(await checkFreshness(MINE, serving({ en: 5 }))).toBe('unknown');
    expect(await checkFreshness(MINE, (async () => new Response('<html>')) as typeof fetch)).toBe('unknown');
    expect(await checkFreshness(MINE, (async () => { throw new TypeError('offline'); }) as typeof fetch)).toBe('unknown');
  });

  it('asks past every cache', async () => {
    let init: RequestInit | undefined;
    await checkFreshness(MINE, (async (_url: string, i: RequestInit) => ((init = i), new Response('{}'))) as typeof fetch);
    expect(init?.cache).toBe('no-store');
  });
});
