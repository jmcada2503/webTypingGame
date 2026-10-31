import { GetParametersCommand } from "@aws-sdk/client-ssm";

/**
 * TURN relay logins (Cloudflare Realtime TURN), for players who can't reach each other directly (same Wi-Fi
 * without hairpin NAT, strict NATs). The browser adds them next to the free STUN servers and only relays when
 * no direct path works. Cloudflare bills the relayed bytes (1,000 GB/month free), so logins only go to players
 * of a paired match (see `Matchmaker.turn`), expire, and `/typing-game/turn/enabled` turns the relay off.
 */
export interface Turn {
  /** Relay servers for one player, or none (switched off, not set up, Cloudflare failing). Never throws. */
  servers(): Promise<TurnServer[]>;
}

export interface TurnServer {
  urls: string[];
  username: string;
  credential: string;
}

export interface TurnConfig {
  keyId: string;
  apiToken: string;
}

/** SSM parameters: the key id, its API token (SecureString) and the switch (`on` = relay available). */
export const TURN_PARAMS = {
  keyId: "/typing-game/turn/key-id",
  apiToken: "/typing-game/turn/api-token",
  enabled: "/typing-game/turn/enabled",
} as const;

/** No relay: tests, local dev. */
export const NO_TURN: Turn = { servers: async () => [] };

const CLOUDFLARE_API = "https://rtc.live.cloudflare.com/v1/turn/keys";
/** Cloudflare answers in ~100 ms; past this the player connects without a relay. */
const CLOUDFLARE_TIMEOUT_MS = 1500;
/** Port 53 is blocked by browsers: without trickle ICE a dead URL would only slow gathering down. */
const BLOCKED_PORT = /:53(\?|$)/;

export class CloudflareTurn implements Turn {
  constructor(
    private readonly deps: {
      config: () => Promise<TurnConfig | null>;
      fetch?: typeof fetch;
      log: (line: Record<string, unknown>) => void;
      /** How long a login works. It must outlast the session: an active relay needs it to stay up. */
      ttlSeconds: number;
    },
  ) {}

  async servers(): Promise<TurnServer[]> {
    const config = await this.deps.config();
    if (!config) return [];
    try {
      const res = await (this.deps.fetch ?? fetch)(`${CLOUDFLARE_API}/${encodeURIComponent(config.keyId)}/credentials/generate-ice-servers`, {
        method: "POST",
        headers: { authorization: `Bearer ${config.apiToken}`, "content-type": "application/json" },
        body: JSON.stringify({ ttl: this.deps.ttlSeconds }),
        signal: AbortSignal.timeout(CLOUDFLARE_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`cloudflare ${res.status}`);
      return relayServers(await res.json());
    } catch (error) {
      // The message is ours or the runtime's, never the response body (which could echo the token).
      this.deps.log({ event: "turn_error", message: error instanceof Error ? error.message : "unknown" });
      return [];
    }
  }
}

/** The TURN entries of Cloudflare's `iceServers` (the STUN one is dropped: the client has its own). */
function relayServers(body: unknown): TurnServer[] {
  const list = (body as { iceServers?: unknown } | null)?.iceServers;
  if (!Array.isArray(list)) throw new Error("cloudflare: no iceServers");
  const out: TurnServer[] = [];
  for (const entry of list) {
    const { urls, username, credential } = (entry ?? {}) as Record<string, unknown>;
    const all = typeof urls === "string" ? [urls] : urls;
    if (!Array.isArray(all) || !all.every((u) => typeof u === "string")) throw new Error("cloudflare: bad urls");
    const relay = (all as string[]).filter((u) => /^turns?:/.test(u) && !BLOCKED_PORT.test(u));
    if (relay.length === 0) continue;
    if (typeof username !== "string" || typeof credential !== "string") throw new Error("cloudflare: bad credentials");
    out.push({ urls: relay, username, credential });
  }
  if (out.length === 0) throw new Error("cloudflare: no TURN entry");
  return out;
}

/** The config from SSM: null when switched off or not set up. */
export function ssmTurnConfig(ssm: { send(command: GetParametersCommand): Promise<{ Parameters?: { Name?: string; Value?: string }[] }> }) {
  return async (): Promise<TurnConfig | null> => {
    const names = [TURN_PARAMS.keyId, TURN_PARAMS.apiToken, TURN_PARAMS.enabled];
    const out = await ssm.send(new GetParametersCommand({ Names: names, WithDecryption: true }));
    const value = (name: string) => out.Parameters?.find((p) => p.Name === name)?.Value;
    const keyId = value(TURN_PARAMS.keyId);
    const apiToken = value(TURN_PARAMS.apiToken);
    if (value(TURN_PARAMS.enabled) !== "on" || !keyId || !apiToken) return null;
    return { keyId, apiToken };
  };
}

/** Reads the config at most once a minute (so the switch takes effect within a minute). A failed read is no relay. */
export function cachedConfig(read: () => Promise<TurnConfig | null>, now: () => number = Date.now, maxAgeMs = 60_000) {
  let cached: { at: number; value: TurnConfig | null } | null = null;
  return async (): Promise<TurnConfig | null> => {
    if (cached && now() - cached.at < maxAgeMs) return cached.value;
    try {
      cached = { at: now(), value: await read() };
      return cached.value;
    } catch {
      cached = null;
      return null;
    }
  };
}
