import { describe, expect, it } from 'vitest';
import { createServerStatus } from './serverStatus';

const json = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });
const status = (code: number) => async () => new Response('', { status: code });
const offline = async (): Promise<Response> => {
  throw new TypeError('Failed to fetch');
};

/** Answers each check with the next response in order. */
function sequence(...responses: Array<() => Promise<Response>>) {
  let i = 0;
  return () => responses[Math.min(i++, responses.length - 1)]();
}

describe('createServerStatus', () => {
  it('is open when the flag says not resting', async () => {
    const servers = createServerStatus(json({ resting: false, reason: null }));
    expect(await servers.check()).toBe('open');
  });

  it('is resting when the flag says so', async () => {
    const servers = createServerStatus(json({ resting: true, reason: 'estimate' }));
    expect(await servers.check()).toBe('resting');
  });

  it.each([403, 404])('is open while the flag does not exist yet (%i)', async (code) => {
    const servers = createServerStatus(status(code));
    expect(await servers.check()).toBe('open');
  });

  it('keeps the last answer after a single failure', async () => {
    const servers = createServerStatus(sequence(json({ resting: false }), offline));
    expect(await servers.check()).toBe('open');
    expect(await servers.check()).toBe('open');
  });

  it('fails safe to resting after two failures in a row', async () => {
    const servers = createServerStatus(sequence(json({ resting: false }), offline, status(500)));
    await servers.check();
    await servers.check();
    expect(await servers.check()).toBe('resting');
  });

  it('counts a broken flag file as a failure', async () => {
    const servers = createServerStatus(async () => new Response('not json', { status: 200 }));
    await servers.check();
    expect(await servers.check()).toBe('resting');
  });

  it('recovers as soon as the flag is readable again', async () => {
    const servers = createServerStatus(sequence(offline, offline, json({ resting: false })));
    await servers.check();
    expect(await servers.check()).toBe('resting');
    expect(await servers.check()).toBe('open');
  });
});
