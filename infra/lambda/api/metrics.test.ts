import { describe, expect, it } from "vitest";
import { MemoryDetailsStore, Metrics, type DetailsStore } from "./metrics";
import { ApiError } from "./service";

const PID = "player-aaaaaaaaaaaaaaaa";
const AT = 1_790_000_000_000;
const CLIENT = { br: "Chrome", os: "Mac", ret: false };

const MATCH = {
  t: "match", ...CLIENT, lang: "en", at: AT, dur: 95.2, pace: 4.1, peak: 6.3, wpm: 49.2, acc: 0.9, words: 40, letters: 210, wrong: 4,
  missed: ["quizás", "rhythm"], mid: "abc123", n: 0, kind: "public", end: "won", bd: 30, ba: 2, sf: 10, sh: 6, sd: 4, lives: 1,
  attacks: [{ i: 0, w: "house", t: 3.2, o: "hit" }], wait: 4200, howto: "skipped", rtt: 40, invalid: 0, near: 1,
};
const PRACTICE = {
  t: "practice", ...CLIENT, lang: "es", at: AT, dur: 60, pace: 3, peak: 4, wpm: 36, acc: null, words: 20, letters: 90, wrong: 0,
  missed: [], rid: "run42", active: 50, calib: 3.2, start: 12, level: 40,
};
const P2P = {
  t: "p2p", ...CLIENT, mid: "abc123", kind: "public", role: "host", ok: false, fail: "iceFailed", pair: null, ms: null, gather: 300,
  ice: [{ s: "checking", ms: 400 }, { s: "failed", ms: 9000 }], cand: { lh: 2, ls: 1, lr: 0, rh: 1, rs: 0, rr: 0 },
};

function setup(store: DetailsStore = new MemoryDetailsStore(), sampleRate = 1, random = () => 0) {
  const lines: Record<string, unknown>[] = [];
  const metrics = new Metrics({ store, log: (l) => lines.push(l), sampleRate, random });
  return { metrics, lines, store };
}

describe("a Match report", () => {
  it("is logged without the attack list and kept in the history with it", async () => {
    const { metrics, lines, store } = setup();
    await metrics.report(PID, MATCH, "CO");
    expect(lines).toEqual([expect.objectContaining({ t: "match", v: 1, pid: PID, cc: "CO", mid: "abc123", end: "won" })]);
    expect(lines[0]).not.toHaveProperty("attacks");
    const items = [...(store as MemoryDetailsStore).items.values()];
    expect(items).toEqual([expect.objectContaining({ pid: PID, sk: `${AT}#abc123#0`, attacks: MATCH.attacks })]);
  });

  it("a retry with the same body is logged once", async () => {
    const { metrics, lines } = setup();
    await metrics.report(PID, MATCH);
    await metrics.report(PID, MATCH);
    expect(lines).toHaveLength(1);
  });

  it("a Rematch is its own Match", async () => {
    const { metrics, lines } = setup();
    await metrics.report(PID, MATCH);
    await metrics.report(PID, { ...MATCH, n: 1 });
    expect(lines).toHaveLength(2);
  });

  it("over the free capacity: still logged, marked dropped", async () => {
    const { metrics, lines } = setup({ put: async () => "throttled" });
    await metrics.report(PID, MATCH);
    expect(lines[0]).toMatchObject({ dropped: true });
  });

  it("an unknown or odd country is left out", async () => {
    const { metrics, lines } = setup();
    await metrics.report(PID, MATCH, "XX1");
    expect(lines[0].cc).toBeNull();
  });
});

describe("the other records", () => {
  it("Practice goes to the log and the history", async () => {
    const { metrics, lines, store } = setup();
    await metrics.report(PID, PRACTICE);
    expect(lines[0]).toMatchObject({ t: "practice", rid: "run42", acc: null });
    expect([...(store as MemoryDetailsStore).items.keys()]).toEqual([`${PID}|${AT}#run42`]);
  });

  it("connection attempts, Matchmaking give-ups and Rematch outcomes are log only", async () => {
    const { metrics, lines, store } = setup();
    await metrics.report(PID, P2P);
    await metrics.report(PID, { t: "mm", ...CLIENT, kind: "public", lang: "en", wait: 30_000, why: "left" });
    await metrics.report(PID, { t: "rematch", ...CLIENT, mid: "abc123", kind: "public", n: 0, out: "declined" });
    expect(lines.map((l) => l.t)).toEqual(["p2p", "mm", "rematch"]);
    expect((store as MemoryDetailsStore).items.size).toBe(0);
  });

  it("booleans are logged as 0/1 and a success has fail \"none\" (Logs Insights sums and compares them)", async () => {
    const { metrics, lines } = setup();
    await metrics.report(PID, { ...P2P, ok: true, fail: null, pair: "srflx", ms: 800, ret: true });
    expect(lines[0]).toMatchObject({ ok: 1, ret: 1, fail: "none" });
  });

  it("unknown fields are dropped", async () => {
    const { metrics, lines } = setup();
    await metrics.report(PID, { ...P2P, ip: "1.2.3.4", userAgent: "Mozilla/5.0 ..." });
    expect(lines[0]).not.toHaveProperty("ip");
    expect(lines[0]).not.toHaveProperty("userAgent");
  });
});

describe("validation", () => {
  const bad: Array<[string, unknown]> = [
    ["no record", undefined],
    ["an unknown type", { ...MATCH, t: "cheat" }],
    ["a prototype key as type", { ...MATCH, t: "constructor" }],
    ["a missing field", { ...MATCH, end: undefined }],
    ["an unknown ending", { ...MATCH, end: "draw" }],
    ["a negative count", { ...MATCH, words: -1 }],
    ["a non-number Pace", { ...MATCH, pace: "fast" }],
    ["too many missed words", { ...MATCH, missed: Array(11).fill("word") }],
    ["a missed word with odd characters", { ...MATCH, missed: ["<script>"] }],
    ["too many attacks", { ...MATCH, attacks: Array(121).fill(MATCH.attacks[0]) }],
    ["a bad match id", { ...MATCH, mid: "NOPE!" }],
    ["an accuracy above 1", { ...MATCH, acc: 1.5 }],
    ["a time in the distant past", { ...MATCH, at: 5 }],
    ["an odd browser name", { ...P2P, br: "Mozilla/5.0 (X11)" }],
    ["a bad ICE state", { ...P2P, ice: [{ s: "Failed!", ms: 1 }] }],
  ];
  it.each(bad)("rejects %s", async (_, record) => {
    const { metrics, lines } = setup();
    await expect(metrics.report(PID, record)).rejects.toEqual(new ApiError(400, "invalid"));
    expect(lines).toHaveLength(0);
  });
});

describe("sampling (the kill switch)", () => {
  it("rate 0 drops everything, but still checks the record", async () => {
    const { metrics, lines } = setup(undefined, 0);
    await metrics.report(PID, MATCH);
    expect(lines).toHaveLength(0);
    await expect(metrics.report(PID, { t: "x" })).rejects.toBeInstanceOf(ApiError);
  });

  it("a sampled line carries its weight", async () => {
    const kept = setup(undefined, 0.25, () => 0.1);
    await kept.metrics.report(PID, P2P);
    expect(kept.lines[0]).toMatchObject({ w: 4 });
    const dropped = setup(undefined, 0.25, () => 0.5);
    await dropped.metrics.report(PID, P2P);
    expect(dropped.lines).toHaveLength(0);
  });
});
