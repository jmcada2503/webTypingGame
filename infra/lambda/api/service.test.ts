import { beforeEach, describe, expect, it } from "vitest";
import { ApiError, Matchmaker, STALE_MS, type MatchView } from "./service";
import { MemoryStore } from "./memoryStore";

const PID = { a: "player-aaaaaaaaaaaaaaaa", b: "player-bbbbbbbbbbbbbbbb", c: "player-cccccccccccccccc" };
const VERSION = "wl-1234abcd";

function setup(store = new MemoryStore()) {
  const clock = { now: 1_000_000 };
  let ids = 0;
  let seeds = 100;
  const mm = new Matchmaker(store, {
    now: () => clock.now,
    newId: () => `m${++ids}`,
    random32: () => seeds++,
  });
  return { mm, store, clock };
}

/** Hosts reply "waiting" and learn of the pairing by polling; guests reply "paired". */
function summarize(results: MatchView[]) {
  const guests = new Map<string, number>();
  for (const r of results) if (r.role === "guest") guests.set(r.matchId, (guests.get(r.matchId) ?? 0) + 1);
  expect([...guests.values()].every((n) => n === 1)).toBe(true); // nobody is paired twice
  const hosts = results.filter((r) => r.role === "host");
  expect(new Set(hosts.map((h) => h.matchId)).size).toBe(hosts.length);
  for (const id of guests.keys()) expect(hosts.some((h) => h.matchId === id)).toBe(true);
  return { pairs: guests.size, alone: hosts.filter((h) => !guests.has(h.matchId)).length };
}

const code = async (p: Promise<unknown>) => (await p.then(() => null, (e: ApiError) => e)) as ApiError | null;

describe('public matchmaking', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => (t = setup()));

  it('the first player waits, the second one pairs with them', async () => {
    const a = await t.mm.queue(PID.a, "en", VERSION);
    expect(a).toMatchObject({ role: "host", status: "waiting", kind: "public" });

    const b = await t.mm.queue(PID.b, "en", VERSION);
    expect(b).toMatchObject({ matchId: a.matchId, role: "guest", status: "paired" });

    const hostView = await t.mm.poll(PID.a, a.matchId);
    expect(hostView.status).toBe("paired");
  });

  it('gives each player both seeds, mine and theirs swapped, and the host list version', async () => {
    const a = await t.mm.queue(PID.a, "en", VERSION);
    const b = await t.mm.queue(PID.b, "en", "someone-elses-version");
    const hostView = await t.mm.poll(PID.a, a.matchId);
    expect(hostView.listVersion).toBe(VERSION);
    expect(b.listVersion).toBe(VERSION);
    expect(hostView.seeds).toEqual({ mine: b.seeds!.theirs, theirs: b.seeds!.mine });
    expect(hostView.seeds!.mine).not.toBe(hostView.seeds!.theirs);
  });

  it('keeps languages apart', async () => {
    const en = await t.mm.queue(PID.a, "en", VERSION);
    const es = await t.mm.queue(PID.b, "es", VERSION);
    expect(es.role).toBe("host");
    expect(es.matchId).not.toBe(en.matchId);
  });

  it('a third player waits again: the queue is empty after a pairing', async () => {
    await t.mm.queue(PID.a, "en", VERSION);
    await t.mm.queue(PID.b, "en", VERSION);
    const c = await t.mm.queue(PID.c, "en", VERSION);
    expect(c).toMatchObject({ role: "host", status: "waiting" });
  });

  it('does not pair a player with themselves (second tab, refresh)', async () => {
    const first = await t.mm.queue(PID.a, "en", VERSION);
    const again = await t.mm.queue(PID.a, "en", VERSION);
    expect(again).toMatchObject({ matchId: first.matchId, role: "host", status: "waiting" });
    const b = await t.mm.queue(PID.b, "en", VERSION);
    expect(b).toMatchObject({ matchId: first.matchId, role: "guest" });
  });

  it('never pairs a Public searcher with a Private match', async () => {
    const priv = await t.mm.createPrivate(PID.a, "en", VERSION);
    const b = await t.mm.queue(PID.b, "en", VERSION);
    expect(b.role).toBe("host");
    expect(b.matchId).not.toBe(priv.matchId);
  });
});

describe('stale waiters', () => {
  it('discards a waiter who stopped polling and waits instead', async () => {
    const t = setup();
    const a = await t.mm.queue(PID.a, "en", VERSION);
    t.clock.now += STALE_MS + 1000;

    const b = await t.mm.queue(PID.b, "en", VERSION);
    expect(b).toMatchObject({ role: "host", status: "waiting" });
    expect(b.matchId).not.toBe(a.matchId);
    expect(await t.store.get(a.matchId)).toBeNull();

    const c = await t.mm.queue(PID.c, "en", VERSION);
    expect(c).toMatchObject({ matchId: b.matchId, role: "guest" });
  });

  it('still pairs with a waiter just inside the limit', async () => {
    const t = setup();
    const a = await t.mm.queue(PID.a, "en", VERSION);
    t.clock.now += STALE_MS - 500;
    expect((await t.mm.queue(PID.b, "en", VERSION)).matchId).toBe(a.matchId);
  });

  it('a waiter who keeps polling never goes stale', async () => {
    const t = setup();
    const a = await t.mm.queue(PID.a, "en", VERSION);
    for (let i = 0; i < 20; i++) {
      t.clock.now += 1000;
      await t.mm.poll(PID.a, a.matchId);
    }
    expect((await t.mm.queue(PID.b, "en", VERSION)).matchId).toBe(a.matchId);
  });

  it('writes the waiter\'s liveness only about every 4 s, not on every poll', async () => {
    const t = setup();
    const a = await t.mm.queue(PID.a, "en", VERSION);
    const seen = async () => (await t.store.get(a.matchId))!.hostSeen;
    const first = await seen();
    t.clock.now += 1000;
    await t.mm.poll(PID.a, a.matchId);
    expect(await seen()).toBe(first);
    t.clock.now += 3500;
    await t.mm.poll(PID.a, a.matchId);
    expect(await seen()).toBe(t.clock.now);
  });
});

describe('races', () => {
  it('two searchers arriving together end up paired, with nothing left over', async () => {
    const store = new MemoryStore({ yieldBetweenOps: true });
    const t = setup(store);
    const [a, b] = await Promise.all([t.mm.queue(PID.a, "en", VERSION), t.mm.queue(PID.b, "en", VERSION)]);
    expect(a.matchId).toBe(b.matchId);
    expect([a.role, b.role].sort()).toEqual(["guest", "host"]);
    expect(store.matchCount()).toBe(1);
    expect(store.queued("en")).toBeNull();
  });

  it('three searchers together: one pair and one still waiting', async () => {
    const store = new MemoryStore({ yieldBetweenOps: true });
    const t = setup(store);
    const results = await Promise.all([PID.a, PID.b, PID.c].map((p) => t.mm.queue(p, "en", VERSION)));
    const { pairs, alone } = summarize(results);
    expect(pairs).toBe(1);
    expect(alone).toBe(1);
    expect(store.matchCount()).toBe(2);
  });

  it('a crowd arriving together is never double-paired and leaves at most one waiting', async () => {
    const store = new MemoryStore({ yieldBetweenOps: true });
    const t = setup(store);
    const pids = Array.from({ length: 11 }, (_, i) => `player-${String(i).padStart(16, "0")}`);
    // Under this much contention a few are told "busy" (they retry); the rest must be consistent.
    const settled = await Promise.allSettled(pids.map((p) => t.mm.queue(p, "en", VERSION)));
    const results = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    for (const r of settled) if (r.status === "rejected") expect(r.reason).toMatchObject({ code: "busy" });
    const { pairs, alone } = summarize(results);
    expect(pairs).toBeGreaterThan(0);
    expect(alone).toBeLessThanOrEqual(1);
  });

  it('gives up with "busy" after 3 lost races', async () => {
    const store = new MemoryStore();
    store.putQueue = async () => false;
    const t = setup(store);
    expect(await code(t.mm.queue(PID.a, "en", VERSION))).toMatchObject({ status: 503, code: "busy" });
    expect(store.matchCount()).toBe(0);
  });

  it('retries when the waiter is claimed by someone else first', async () => {
    const store = new MemoryStore();
    const t = setup(store);
    const a = await t.mm.queue(PID.a, "en", VERSION);
    const realClaim = store.claim.bind(store);
    let lost = true;
    store.claim = async (...args) => {
      if (lost) {
        lost = false;
        await realClaim(a.matchId, PID.c, { host: 1, guest: 2 }, t.clock.now); // c gets there first
        return null;
      }
      return realClaim(...args);
    };
    const b = await t.mm.queue(PID.b, "en", VERSION);
    expect(b).toMatchObject({ role: "host", status: "waiting" });
  });
});

describe('private matches and invite links', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => (t = setup()));

  it('the host creates one and a friend joins it', async () => {
    const made = await t.mm.createPrivate(PID.a, "es", VERSION);
    expect(made).toMatchObject({ role: "host", status: "waiting", kind: "private", lang: "es" });
    const joined = await t.mm.join(PID.b, made.matchId);
    expect(joined).toMatchObject({ role: "guest", status: "paired", lang: "es" });
  });

  it('a third person gets "full"', async () => {
    const made = await t.mm.createPrivate(PID.a, "en", VERSION);
    await t.mm.join(PID.b, made.matchId);
    expect(await code(t.mm.join(PID.c, made.matchId))).toMatchObject({ status: 409, code: "full" });
  });

  it('an unknown link is "expired"', async () => {
    expect(await code(t.mm.join(PID.b, "nope"))).toMatchObject({ status: 404, code: "expired" });
  });

  it('a link whose host left (stopped polling) is "expired"', async () => {
    const made = await t.mm.createPrivate(PID.a, "en", VERSION);
    t.clock.now += STALE_MS + 1000;
    expect(await code(t.mm.join(PID.b, made.matchId))).toMatchObject({ status: 404, code: "expired" });
  });

  it('has no timer while the host keeps the waiting screen open', async () => {
    const made = await t.mm.createPrivate(PID.a, "en", VERSION);
    for (let i = 0; i < 300; i++) {
      t.clock.now += 2000;
      await t.mm.poll(PID.a, made.matchId);
    }
    expect((await t.mm.join(PID.b, made.matchId)).status).toBe("paired");
  });

  it('joining twice as the same guest is fine; the host opening their own link is not a join', async () => {
    const made = await t.mm.createPrivate(PID.a, "en", VERSION);
    await t.mm.join(PID.b, made.matchId);
    expect((await t.mm.join(PID.b, made.matchId)).role).toBe("guest");
    expect(await code(t.mm.join(PID.a, made.matchId))).toMatchObject({ status: 409, code: "own" });
  });
});

describe('polling', () => {
  let t: ReturnType<typeof setup>;
  let matchId: string;
  beforeEach(async () => {
    t = setup();
    matchId = (await t.mm.queue(PID.a, "en", VERSION)).matchId;
  });

  it('refuses people who are not in the match', async () => {
    expect(await code(t.mm.poll(PID.c, matchId))).toMatchObject({ status: 403, code: "forbidden" });
  });

  it('reports an unknown or finished match as gone', async () => {
    expect(await code(t.mm.poll(PID.a, "nope"))).toMatchObject({ status: 404, code: "gone" });
  });

  it('tells the host when the guest stopped polling', async () => {
    await t.mm.queue(PID.b, "en", VERSION);
    expect((await t.mm.poll(PID.a, matchId)).opponentGone).toBe(false);
    t.clock.now += STALE_MS + 1000;
    expect((await t.mm.poll(PID.a, matchId)).opponentGone).toBe(true);
    await t.mm.poll(PID.b, matchId);
    expect((await t.mm.poll(PID.a, matchId)).opponentGone).toBe(false);
  });
});

describe('signaling', () => {
  let t: ReturnType<typeof setup>;
  let matchId: string;
  beforeEach(async () => {
    t = setup();
    matchId = (await t.mm.queue(PID.a, "en", VERSION)).matchId;
  });

  it('passes the offer to the guest and the answer back to the host', async () => {
    await t.mm.queue(PID.b, "en", VERSION);
    await t.mm.signal(PID.a, matchId, "offer", "v=0 offer");
    const guestView: MatchView = await t.mm.poll(PID.b, matchId);
    expect(guestView.offer).toBe("v=0 offer");
    expect(guestView.answer).toBeUndefined();

    await t.mm.signal(PID.b, matchId, "answer", "v=0 answer");
    const hostView = await t.mm.poll(PID.a, matchId);
    expect(hostView.answer).toBe("v=0 answer");
    expect(hostView.offer).toBeUndefined();
  });

  it('does not accept an offer before the pairing', async () => {
    expect(await code(t.mm.signal(PID.a, matchId, "offer", "x"))).toMatchObject({ status: 409, code: "not_paired" });
  });

  it('only the host sends the offer and only the guest the answer', async () => {
    await t.mm.queue(PID.b, "en", VERSION);
    expect(await code(t.mm.signal(PID.b, matchId, "offer", "x"))).toMatchObject({ status: 403 });
    await t.mm.signal(PID.a, matchId, "offer", "x");
    expect(await code(t.mm.signal(PID.a, matchId, "answer", "x"))).toMatchObject({ status: 403 });
  });

  it('needs the offer before an answer', async () => {
    await t.mm.queue(PID.b, "en", VERSION);
    expect(await code(t.mm.signal(PID.b, matchId, "answer", "x"))).toMatchObject({ status: 409, code: "no_offer" });
  });

  it('caps the description at 8 KB and rejects anything that is not text', async () => {
    await t.mm.queue(PID.b, "en", VERSION);
    expect(await code(t.mm.signal(PID.a, matchId, "offer", "x".repeat(8193)))).toMatchObject({ status: 413 });
    await t.mm.signal(PID.a, matchId, "offer", "x".repeat(8192));
    expect(await code(t.mm.signal(PID.a, matchId, "offer", "" as string))).toMatchObject({ status: 400 });
  });
});

describe('connected and leaving', () => {
  it('both players confirming shortens how long the match lingers', async () => {
    const t = setup();
    const a = await t.mm.queue(PID.a, "en", VERSION);
    await t.mm.queue(PID.b, "en", VERSION);
    expect((await t.mm.connected(PID.a, a.matchId)).bothConnected).toBe(false);
    const before = (await t.store.get(a.matchId))!.ttl;
    expect((await t.mm.connected(PID.b, a.matchId)).bothConnected).toBe(true);
    expect((await t.store.get(a.matchId))!.ttl).toBeLessThan(before);
  });

  it('the waiting host leaving takes the queue pointer with them', async () => {
    const t = setup();
    const a = await t.mm.queue(PID.a, "en", VERSION);
    await t.mm.leave(PID.a, a.matchId);
    expect(t.store.queued("en")).toBeNull();
    expect((await t.mm.queue(PID.b, "en", VERSION)).role).toBe("host");
  });

  it('leaving a paired match ends it for the other player', async () => {
    const t = setup();
    const a = await t.mm.queue(PID.a, "en", VERSION);
    await t.mm.queue(PID.b, "en", VERSION);
    await t.mm.leave(PID.b, a.matchId);
    expect(await code(t.mm.poll(PID.a, a.matchId))).toMatchObject({ code: "gone" });
  });

  it('leaving a match that is already gone is fine', async () => {
    const t = setup();
    await expect(t.mm.leave(PID.a, "nope")).resolves.toBeUndefined();
  });
});

describe('ended matches are kept for debugging, but are over', () => {
  const DAY_SECONDS = 24 * 3600;

  async function failedConnection() {
    const t = setup();
    const a = await t.mm.queue(PID.a, "en", VERSION);
    await t.mm.queue(PID.b, "en", VERSION);
    await t.mm.signal(PID.a, a.matchId, "offer", "v=0 offer");
    await t.mm.signal(PID.b, a.matchId, "answer", "v=0 answer");
    await t.mm.leave(PID.b, a.matchId); // the guest gave up (connection timeout)
    return { t, id: a.matchId };
  }

  it('leaving keeps the item, with its offer and answer, for a day', async () => {
    const { t, id } = await failedConnection();
    const item = await t.store.get(id);
    expect(item).toMatchObject({ status: "ended", endedBy: "guest", offer: "v=0 offer", answer: "v=0 answer" });
    expect(item!.ttl).toBe(Math.floor(t.clock.now / 1000) + DAY_SECONDS);
  });

  it('an ended match is gone for polling, signaling and connecting', async () => {
    const { t, id } = await failedConnection();
    expect(await code(t.mm.poll(PID.a, id))).toMatchObject({ status: 404, code: "gone" });
    expect(await code(t.mm.signal(PID.a, id, "offer", "v=0 again"))).toMatchObject({ status: 404, code: "gone" });
    expect(await code(t.mm.connected(PID.a, id))).toMatchObject({ status: 404, code: "gone" });
  });

  it('leaving an ended match again changes nothing', async () => {
    const { t, id } = await failedConnection();
    t.clock.now += 60_000;
    await t.mm.leave(PID.a, id);
    expect(await t.store.get(id)).toMatchObject({ endedBy: "guest", endedAt: t.clock.now - 60_000 });
  });

  it('an ended private match link is "expired"', async () => {
    const t = setup();
    const made = await t.mm.createPrivate(PID.a, "en", VERSION);
    await t.mm.leave(PID.a, made.matchId);
    expect(await code(t.mm.join(PID.b, made.matchId))).toMatchObject({ status: 404, code: "expired" });
  });

  it('a waiter who left is never paired: the next searcher waits instead', async () => {
    const t = setup();
    const a = await t.mm.queue(PID.a, "en", VERSION);
    await t.store.putQueue("en", a.matchId); // the pointer outlived the leave (race)
    await t.mm.leave(PID.a, a.matchId);
    await t.store.putQueue("en", a.matchId);
    const b = await t.mm.queue(PID.b, "en", VERSION);
    expect(b).toMatchObject({ role: "host", status: "waiting" });
    expect(b.matchId).not.toBe(a.matchId);
  });
});

describe('ICE reports: why a connection attempt failed', () => {
  const report = () => ({
    fail: "timeout",
    ms: 10_000,
    ice: "checking",
    gathering: "complete",
    cands: [
      { side: "local", type: "host", address: "0a1b2c3d-1111-2222-3333-444455556666.local", port: 54321, protocol: "udp" },
      { side: "local", type: "srflx", address: "203.0.113.7", port: 61000, protocol: "udp" },
      { side: "remote", type: "srflx", address: "203.0.113.7", port: 62000, protocol: "udp" },
    ],
    pairs: [
      { local: 0, remote: 2, state: "failed", nominated: false, requestsSent: 9, responsesReceived: 0, requestsReceived: 0, responsesSent: 0 },
      { local: 1, remote: 2, state: "in-progress", nominated: false, requestsSent: 7, responsesReceived: 0, requestsReceived: 3, responsesSent: 3 },
    ],
  });

  async function paired() {
    const t = setup();
    const a = await t.mm.queue(PID.a, "en", VERSION);
    await t.mm.queue(PID.b, "en", VERSION);
    return { t, id: a.matchId };
  }

  it('each player saves their own report on the match, with the time', async () => {
    const { t, id } = await paired();
    await t.mm.ice(PID.a, id, report());
    t.clock.now += 500;
    await t.mm.ice(PID.b, id, { ...report(), fail: "aborted" });
    const item = await t.store.get(id);
    expect(item!.hostIce).toEqual({ ...report(), at: t.clock.now - 500 });
    expect(item!.guestIce).toMatchObject({ fail: "aborted", at: t.clock.now });
  });

  it('is accepted after the match ended (the player left right after failing)', async () => {
    const { t, id } = await paired();
    await t.mm.leave(PID.b, id);
    await t.mm.ice(PID.a, id, report());
    expect((await t.store.get(id))!.hostIce).toMatchObject({ fail: "timeout" });
  });

  it('refuses people who are not in the match, and unknown matches', async () => {
    const { t, id } = await paired();
    expect(await code(t.mm.ice(PID.c, id, report()))).toMatchObject({ status: 403 });
    expect(await code(t.mm.ice(PID.a, "nope", report()))).toMatchObject({ status: 404, code: "gone" });
  });

  it('rejects anything that is not a well-formed report', async () => {
    const { t, id } = await paired();
    const bad = [
      null,
      "text",
      { ...report(), fail: "boom" },
      { ...report(), ms: -1 },
      { ...report(), cands: "x" },
      { ...report(), cands: Array.from({ length: 31 }, () => report().cands[0]) },
      { ...report(), cands: [{ ...report().cands[0], address: "<script>" }] },
      { ...report(), pairs: [{ ...report().pairs[0], state: "weird" }] },
      { ...report(), pairs: [{ ...report().pairs[0], local: 3 }] }, // no such candidate
      { ...report(), pairs: Array.from({ length: 51 }, () => report().pairs[0]) },
    ];
    for (const value of bad) expect(await code(t.mm.ice(PID.a, id, value)), JSON.stringify(value)?.slice(0, 80)).toMatchObject({ status: 400 });
    expect((await t.store.get(id))!.hostIce).toBeUndefined();
  });

  it('keeps only the fields it knows', async () => {
    const { t, id } = await paired();
    await t.mm.ice(PID.a, id, { ...report(), extra: "x", cands: [{ ...report().cands[0], foo: 1 }], pairs: [] });
    const saved = (await t.store.get(id))!.hostIce as unknown as Record<string, unknown>;
    expect(saved.extra).toBeUndefined();
    expect((saved.cands as Record<string, unknown>[])[0].foo).toBeUndefined();
  });
});

describe('TURN relay logins', () => {
  const SERVERS = [{ urls: ["turn:turn.example:3478?transport=udp"], username: "u", credential: "c" }];

  function withTurn() {
    let issued = 0;
    const store = new MemoryStore();
    const mm = new Matchmaker(store, {
      now: () => 1_000_000,
      newId: () => "m1",
      random32: () => 7,
      turn: {
        servers: async () => {
          issued++;
          return SERVERS;
        },
      },
    });
    return { mm, store, issued: () => issued };
  }

  it('both players of a paired match get relay servers', async () => {
    const { mm } = withTurn();
    const a = await mm.queue(PID.a, "en", VERSION);
    await mm.queue(PID.b, "en", VERSION);
    expect(await mm.turn(PID.a, a.matchId)).toEqual({ iceServers: SERVERS });
    expect(await mm.turn(PID.b, a.matchId)).toEqual({ iceServers: SERVERS });
  });

  it('nobody else, and not before the pairing or after the end (each relayed byte costs)', async () => {
    const { mm, issued } = withTurn();
    const a = await mm.queue(PID.a, "en", VERSION);
    expect(await code(mm.turn(PID.a, a.matchId))).toMatchObject({ status: 409, code: "not_paired" });
    await mm.queue(PID.b, "en", VERSION);
    expect(await code(mm.turn(PID.c, a.matchId))).toMatchObject({ status: 403 });
    await mm.leave(PID.b, a.matchId);
    expect(await code(mm.turn(PID.a, a.matchId))).toMatchObject({ status: 404, code: "gone" });
    expect(await code(mm.turn(PID.a, "nope"))).toMatchObject({ status: 404 });
    expect(issued()).toBe(0);
  });

  it('without a relay set up the answer is an empty list', async () => {
    const t = setup();
    const a = await t.mm.queue(PID.a, "en", VERSION);
    await t.mm.queue(PID.b, "en", VERSION);
    expect(await t.mm.turn(PID.a, a.matchId)).toEqual({ iceServers: [] });
  });
});
