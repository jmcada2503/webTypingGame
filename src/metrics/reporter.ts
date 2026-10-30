import { sha256Hex } from '../net/api';
import { browserName } from '../net/rtc';
import type { ClientInfo, MetricRecord } from './records';

const FIRST_DAY_KEY = 'typing-game.first-day';
const RETRY_MS = 3000;

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** OS family only (never the full user agent). Order matters: iPads may say Mac, Android says Linux. */
export function osName(userAgent: string): string {
  for (const [token, name] of [
    ['iPhone', 'iOS'],
    ['iPad', 'iOS'],
    ['Android', 'Android'],
    ['CrOS', 'ChromeOS'],
    ['Windows', 'Windows'],
    ['Mac OS X', 'Mac'],
    ['Macintosh', 'Mac'],
    ['Linux', 'Linux'],
  ] as const) {
    if (userAgent.includes(token)) return name;
  }
  return 'Other';
}

/** Browser and OS family, and whether this browser first played on an earlier day (remembered in storage). */
export function clientInfo(userAgent: string, storage: Store | null, today: string): ClientInfo {
  let ret = false;
  try {
    const first = storage?.getItem(FIRST_DAY_KEY);
    if (first && /^\d{4}-\d{2}-\d{2}$/.test(first)) ret = first < today;
    else storage?.setItem(FIRST_DAY_KEY, today);
  } catch {
    // storage blocked: count as new
  }
  return { br: browserName(userAgent).replace(/[^A-Za-z]/g, '').slice(0, 16) || 'Other', os: osName(userAgent), ret };
}

export type Report = (record: MetricRecord) => void;

/**
 * Sends each record to `POST /api/report`, fire-and-forget: metrics never get in the way of the game.
 * `keepalive` lets the last report leave even when the tab is closing. One retry on a network error or a
 * server error (the server ignores a duplicate). Same signing rule as every POST: the body's SHA-256 travels along.
 */
export function createReporter(pid: string, client: ClientInfo, fetchFn: typeof fetch = (...a) => fetch(...a), retryMs = RETRY_MS): Report {
  const post = async (text: string, hash: string) => {
    const res = await fetchFn('/api/report', {
      method: 'POST',
      body: text,
      keepalive: true,
      headers: { 'content-type': 'application/json', 'x-amz-content-sha256': hash },
    });
    if (res.status >= 500) throw new Error(`report ${res.status}`);
  };
  return (record) => {
    const text = JSON.stringify({ pid, r: { ...client, ...record } });
    void (async () => {
      const hash = await sha256Hex(text);
      try {
        await post(text, hash);
      } catch {
        await new Promise((r) => setTimeout(r, retryMs));
        await post(text, hash).catch(() => {});
      }
    })().catch(() => {});
  };
}
