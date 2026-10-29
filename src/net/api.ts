import type { Language } from '../flow/types';

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
  leave(matchId: string): Promise<void>;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The HTTP client for `/api/*` (same origin, behind CloudFront). Every POST carries the SHA-256 of its body:
 * CloudFront signs requests to the Lambda Function URL, and AWS rejects a signed POST without it.
 */
export function createApi(pid: string, fetchFn: typeof fetch = (...args) => fetch(...args), base = ''): MatchApi {
  async function call<T>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<T> {
    const text = body === undefined ? undefined : JSON.stringify({ pid, ...body });
    const headers: Record<string, string> = {};
    if (text !== undefined) {
      headers['content-type'] = 'application/json';
      headers['x-amz-content-sha256'] = await sha256Hex(text);
    }
    const res = await fetchFn(base + path, { method, body: text, headers, cache: 'no-store' });
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) throw new ApiError(res.status, json?.error ?? 'http_error');
    return json as T;
  }
  const match = (id: string) => `/api/match/${encodeURIComponent(id)}`;
  return {
    queue: (lang, listVersion) => call('POST', '/api/queue', { lang, listVersion }),
    createMatch: (lang, listVersion) => call('POST', '/api/match', { lang, listVersion }),
    join: (id) => call('POST', `${match(id)}/join`, {}),
    poll: (id) => call('GET', `${match(id)}?pid=${encodeURIComponent(pid)}`),
    signal: async (id, type, sdp) => void (await call('POST', `${match(id)}/signal`, { type, sdp })),
    connected: (id) => call('POST', `${match(id)}/connected`, {}),
    leave: async (id) => void (await call('POST', `${match(id)}/leave`, {})),
  };
}
