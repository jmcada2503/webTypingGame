import { describe, expect, it } from 'vitest';
import { ApiError, createApi, sha256Hex } from './api';

const PID = 'player-aaaaaaaaaaaaaaaa';

function recording(status = 200, body: unknown = { matchId: 'abc' }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { calls, api: createApi(PID, fetchFn) };
}

describe('createApi', () => {
  it('hashes like SHA-256', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('sends the player id and the body hash with every POST', async () => {
    const { calls, api } = recording();
    await api.queue('es', 'v1');
    const { url, init } = calls[0];
    expect(url).toBe('/api/queue');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ pid: PID, lang: 'es', listVersion: 'v1' });
    const headers = init.headers as Record<string, string>;
    expect(headers['x-amz-content-sha256']).toBe(await sha256Hex(init.body as string));
  });

  it('polls with the player id in the query and no body', async () => {
    const { calls, api } = recording();
    await api.poll('m1');
    expect(calls[0].url).toBe(`/api/match/m1?pid=${PID}`);
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.body).toBeUndefined();
  });

  it('routes the match actions', async () => {
    const { calls, api } = recording();
    await api.createMatch('en', 'v');
    await api.join('m1');
    await api.signal('m1', 'offer', 'sdp');
    await api.connected('m1');
    await api.leave('m1');
    expect(calls.map((c) => c.url)).toEqual(['/api/match', '/api/match/m1/join', '/api/match/m1/signal', '/api/match/m1/connected', '/api/match/m1/leave']);
    expect(JSON.parse(calls[2].init.body as string)).toMatchObject({ type: 'offer', sdp: 'sdp' });
  });

  it('turns refusals into an ApiError with the backend code', async () => {
    const { api } = recording(409, { error: 'full' });
    const error = await api.join('m1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'full' });
  });

  it('copes with an error that is not JSON (e.g. a CloudFront page)', async () => {
    const fetchFn = (async () => new Response('<html>', { status: 502 })) as typeof fetch;
    const error = await createApi(PID, fetchFn).poll('m1').catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 502, code: 'http_error' });
  });
});
