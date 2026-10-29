/**
 * Whether online play is available. The cost guardrails publish `/status.json` (cached ~30 s);
 * when it says resting, online modes show the resting screen and Practice stays playable.
 */
export type ServerState = 'open' | 'resting';

/** Failures in a row before we stop trusting the last answer and assume resting. */
const FAILS_TO_REST = 2;

const fetchFlag = () => fetch('/status.json', { cache: 'no-store' });

export function createServerStatus(fetchStatus: () => Promise<Response> = fetchFlag) {
  let last: ServerState = 'open';
  let failures = 0;

  async function read(): Promise<ServerState> {
    const res = await fetchStatus();
    // No flag yet: the guardrails create it on their first run, until then servers are open.
    if (res.status === 403 || res.status === 404) return 'open';
    if (!res.ok) throw new Error(`status.json: HTTP ${res.status}`);
    const flag = (await res.json()) as { resting?: unknown };
    return flag.resting === true ? 'resting' : 'open';
  }

  return {
    async check(): Promise<ServerState> {
      try {
        last = await read();
        failures = 0;
      } catch {
        failures++;
        if (failures >= FAILS_TO_REST) last = 'resting';
      }
      return last;
    },
  };
}
