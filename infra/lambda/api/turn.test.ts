import { describe, expect, it } from "vitest";
import { CloudflareTurn, cachedConfig, ssmTurnConfig, TURN_PARAMS, type TurnConfig } from "./turn";

const CONFIG: TurnConfig = { keyId: "key123", apiToken: "secret-token" };

/** Cloudflare's answer to generate-ice-servers: a STUN entry, then the TURN entry with every URL. */
const CLOUDFLARE_ANSWER = {
  iceServers: [
    { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
    {
      urls: [
        "turn:turn.cloudflare.com:3478?transport=udp",
        "turn:turn.cloudflare.com:53?transport=udp",
        "turn:turn.cloudflare.com:3478?transport=tcp",
        "turns:turn.cloudflare.com:5349?transport=tcp",
        "turns:turn.cloudflare.com:443?transport=tcp",
      ],
      username: "user-abc",
      credential: "pass-xyz",
    },
  ],
};

function setup(answer: () => Promise<Response> = async () => Response.json(CLOUDFLARE_ANSWER, { status: 201 }), config: TurnConfig | null = CONFIG) {
  const calls: { url: string; init: RequestInit }[] = [];
  const logs: Record<string, unknown>[] = [];
  const turn = new CloudflareTurn({
    config: async () => config,
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return answer();
    }) as typeof fetch,
    log: (line) => logs.push(line),
    ttlSeconds: 4 * 3600,
  });
  return { turn, calls, logs };
}

describe("CloudflareTurn", () => {
  it("asks Cloudflare for short-lived credentials with the key's token", async () => {
    const { turn, calls } = setup();
    await turn.servers();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://rtc.live.cloudflare.com/v1/turn/keys/key123/credentials/generate-ice-servers");
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer secret-token");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ ttl: 4 * 3600 });
  });

  it("returns only the TURN entry, without the port-53 URLs browsers block", async () => {
    const { turn } = setup();
    expect(await turn.servers()).toEqual([
      {
        urls: [
          "turn:turn.cloudflare.com:3478?transport=udp",
          "turn:turn.cloudflare.com:3478?transport=tcp",
          "turns:turn.cloudflare.com:5349?transport=tcp",
          "turns:turn.cloudflare.com:443?transport=tcp",
        ],
        username: "user-abc",
        credential: "pass-xyz",
      },
    ]);
  });

  it("switched off or not set up: no relay, and Cloudflare is not called", async () => {
    const { turn, calls } = setup(undefined, null);
    expect(await turn.servers()).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("Cloudflare refusing, failing or answering nonsense: no relay (the game stays STUN-only), logged", async () => {
    const answers = [
      async () => new Response("nope", { status: 401 }),
      async () => {
        throw new TypeError("fetch failed");
      },
      async () => Response.json({ iceServers: "x" }, { status: 201 }),
      async () => Response.json({ iceServers: [{ urls: ["turn:a:3478"], username: 5, credential: "c" }] }, { status: 201 }),
    ];
    for (const answer of answers) {
      const { turn, logs } = setup(answer);
      expect(await turn.servers()).toEqual([]);
      expect(logs).toEqual([expect.objectContaining({ event: "turn_error" })]);
    }
  });

  it("never logs the token", async () => {
    const { turn, logs } = setup(async () => new Response("bad token secret-token", { status: 401 }));
    await turn.servers();
    expect(JSON.stringify(logs)).not.toContain("secret-token");
  });
});

describe("cachedConfig", () => {
  it("reads the parameters once a minute, not on every request", async () => {
    let reads = 0;
    const clock = { now: 0 };
    const config = cachedConfig(async () => {
      reads++;
      return CONFIG;
    }, () => clock.now);
    await config();
    clock.now += 59_000;
    await config();
    expect(reads).toBe(1);
    clock.now += 2000;
    expect(await config()).toEqual(CONFIG);
    expect(reads).toBe(2);
  });

  it("a failed read means no relay, and is retried on the next request", async () => {
    let fail = true;
    const config = cachedConfig(async () => {
      if (fail) throw new Error("ssm down");
      return CONFIG;
    }, () => 0);
    expect(await config()).toBeNull();
    fail = false;
    expect(await config()).toEqual(CONFIG);
  });
});

describe("ssmTurnConfig", () => {
  const params = (values: Record<string, string>) => {
    const asked: unknown[] = [];
    const read = ssmTurnConfig({
      send: async (command: { input: unknown }) => {
        asked.push(command.input);
        return { Parameters: Object.entries(values).map(([Name, Value]) => ({ Name, Value })) };
      },
    });
    return { read, asked };
  };

  it("reads the key id, the decrypted token and the switch in one call", async () => {
    const { read, asked } = params({ [TURN_PARAMS.keyId]: "key123", [TURN_PARAMS.apiToken]: "secret-token", [TURN_PARAMS.enabled]: "on" });
    expect(await read()).toEqual(CONFIG);
    expect(asked).toEqual([{ Names: [TURN_PARAMS.keyId, TURN_PARAMS.apiToken, TURN_PARAMS.enabled], WithDecryption: true }]);
  });

  it("the switch set to anything but on, or a missing parameter: no relay", async () => {
    expect(await params({ [TURN_PARAMS.keyId]: "k", [TURN_PARAMS.apiToken]: "t", [TURN_PARAMS.enabled]: "off" }).read()).toBeNull();
    expect(await params({ [TURN_PARAMS.keyId]: "k", [TURN_PARAMS.enabled]: "on" }).read()).toBeNull();
    expect(await params({}).read()).toBeNull();
  });
});
