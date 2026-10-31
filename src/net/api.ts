import type { Language } from '../flow/types';
import type { IceReport } from './errors';

/** What the backend shows a player of a match (mirrors `infra/lambda/api/service.ts`). */
export interface MatchView {
  matchId: string;
  role: 'host' | 'guest';
  status: 'waiting' | 'paired';
  kind: 'public' | 'private';
  lang: Language;
  listVersion: string;
  seeds?: { mine: number; theirs: number };
  /** The host's offer, shown to the guest. */
  offer?: string;
  /** The guest's answer, shown to the host. */
  answer?: string;
  opponentGone: boolean;
  bothConnected: boolean;
}

/** A refusal from the backend: `code` is its error code (`busy`, `full`, `expired`, `gone`...). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`api ${status} ${code}`);
  }
}

/** Matchmaking and signaling, as one player (the player id is bound in). */
export interface MatchApi {
  queue(lang: Language, listVersion: string): Promise<MatchView>;
  createMatch(lang: Language, listVersion: string): Promise<MatchView>;
  join(matchId: string): Promise<MatchView>;
  poll(matchId: string): Promise<MatchView>;
  signal(matchId: string, type: 'offer' | 'answer', sdp: string): Promise<void>;
  connected(matchId: string): Promise<MatchView>;
  /** TURN relay servers for this match (empty when the backend has none). */
  turn(matchId: string): Promise<RTCIceServer[]>;
  /** Saves why my connection attempt didn't open (accepted after the match ended too). */
  ice(matchId: string, report: IceReport): Promise<void>;
  leave(matchId: string): Promise<void>;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * One call to `/api/*` (same origin, behind CloudFront). Every POST carries the SHA-256 of its body: CloudFront
 * signs requests to the Lambda Function URL, and AWS rejects a signed POST without it.
 */
async function request<T>(
  fetchFn: typeof fetch,
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
  cache: RequestCache = 'no-store',
): Promise<T> {
  const text = body === undefined ? undefined : JSON.stringify(body);
  const headers: Record<string, string> = {};
  if (text !== undefined) {
    headers['content-type'] = 'application/json';
    headers['x-amz-content-sha256'] = await sha256Hex(text);
  }
  const res = await fetchFn(path, { method, body: text, headers, cache });
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new ApiError(res.status, json?.error ?? 'http_error');
  return json as T;
}

const browserFetch: typeof fetch = (...args) => fetch(...args);

/** The relay servers in a `/turn` answer; anything malformed means none (the game works without a relay). */
function relayServers(body: unknown): RTCIceServer[] {
  const list = (body as { iceServers?: unknown } | null)?.iceServers;
  if (!Array.isArray(list)) return [];
  const ok = list.every((s: Record<string, unknown> | null) => {
    const urls = s?.urls;
    return (
      Array.isArray(urls) && urls.length > 0 && urls.every((u) => typeof u === 'string') &&
      typeof s?.username === 'string' && typeof s?.credential === 'string'
    );
  });
  return ok ? (list as RTCIceServer[]) : [];
}

/** The matchmaking and signaling client, as player `pid`. */
export function createApi(pid: string, fetchFn: typeof fetch = browserFetch, base = ''): MatchApi {
  const call = <T>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>) =>
    request<T>(fetchFn, method, base + path, body && { pid, ...body });
  const match = (id: string) => `/api/match/${encodeURIComponent(id)}`;
  return {
    queue: (lang, listVersion) => call('POST', '/api/queue', { lang, listVersion }),
    createMatch: (lang, listVersion) => call('POST', '/api/match', { lang, listVersion }),
    join: (id) => call('POST', `${match(id)}/join`, {}),
    poll: (id) => call('GET', `${match(id)}?pid=${encodeURIComponent(pid)}`),
    signal: async (id, type, sdp) => void (await call('POST', `${match(id)}/signal`, { type, sdp })),
    connected: (id) => call('POST', `${match(id)}/connected`, {}),
    turn: async (id) => relayServers(await call('POST', `${match(id)}/turn`, {})),
    ice: async (id, report) => void (await call('POST', `${match(id)}/ice`, { report })),
    leave: async (id) => void (await call('POST', `${match(id)}/leave`, {})),
  };
}

/** The online count: a heartbeat for this tab, and the count (cached for 30 s, so the HTTP cache may answer). */
export function createPresenceApi(pid: string, fetchFn: typeof fetch = browserFetch, base = '') {
  return {
    beat: async (lang: Language) => void (await request(fetchFn, 'POST', `${base}/api/presence`, { pid, lang })),
    online: () => request<{ en: number; es: number; total: number; sample?: number }>(fetchFn, 'GET', `${base}/api/online`, undefined, 'default'),
  };
}
