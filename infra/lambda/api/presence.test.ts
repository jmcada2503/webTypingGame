import { describe, expect, it } from "vitest";
import { BUCKET_MS, MemoryPresenceStore, Presence, SAMPLE_TARGET } from "./presence";

function setup() {
  const clock = { now: 10 * BUCKET_MS + 1000 };
  const store = new MemoryPresenceStore();
  const logs: unknown[] = [];
  const presence = new Presence(store, { now: () => clock.now, log: (e) => logs.push(e) });
  const nextWindow = () => (clock.now += BUCKET_MS);
  return { presence, store, clock, logs, nextWindow };
}

describe("presence", () => {
  it("uses 60 s windows", () => {
    expect(BUCKET_MS).toBe(60_000);
  });

  it("counts each heartbeat in its window, per language", async () => {
    const { presence, store } = setup();
    await presence.beat("en");
    await presence.beat("en");
    await presence.beat("es");
    expect(await store.count("en", 10)).toBe(2);
    expect(await store.count("es", 10)).toBe(1);
  });

  it("reports the last complete window, not the one still filling", async () => {
    const { presence, nextWindow } = setup();
    await presence.beat("en");
    await presence.beat("es");
    expect(await presence.online()).toMatchObject({ en: 0, es: 0, total: 0 });
    nextWindow();
    await presence.beat("en"); // the new window: not counted yet
    expect(await presence.online()).toMatchObject({ en: 1, es: 1, total: 2 });
  });

  it("forgets windows older than the last complete one", async () => {
    const { presence, nextWindow } = setup();
    await presence.beat("en");
    nextWindow();
    nextWindow();
    expect((await presence.online()).total).toBe(0);
  });

  it("logs every count it reports, for the peak-players metric", async () => {
    const { presence, logs, nextWindow } = setup();
    await presence.beat("en");
    nextWindow();
    await presence.online();
    expect(logs).toEqual([{ event: "online_count", en: 1, es: 0, total: 1, window: 10, sample: 1 }]);
  });
});

describe("sampling above 50 tabs", () => {
  it(`asks every tab while ${SAMPLE_TARGET} or fewer are online`, async () => {
    const { presence, nextWindow } = setup();
    for (let i = 0; i < SAMPLE_TARGET; i++) await presence.beat("en");
    nextWindow();
    expect((await presence.online()).sample).toBe(1);
  });

  it("past that, asks only a share so about 50 heartbeats arrive per window", async () => {
    const { presence, nextWindow } = setup();
    for (let i = 0; i < 200; i++) await presence.beat(i < 150 ? "en" : "es");
    nextWindow();
    const online = await presence.online();
    expect(online).toMatchObject({ en: 150, es: 50, total: 200 });
    expect(online.sample).toBeCloseTo(0.25, 6);
  });

  it("each sampled heartbeat counts for 1/p, so the estimate stays the real number", async () => {
    const { presence, nextWindow } = setup();
    for (let i = 0; i < 200; i++) await presence.beat("en"); // window 10: 200 tabs, all reporting
    nextWindow();
    for (let i = 0; i < 50; i++) await presence.beat("en"); // window 11: p = 0.25, about 50 of the 200 report
    nextWindow();
    expect((await presence.online()).en).toBe(200);
  });

  it("uses its own rate, not one the client claims, and reads it once per window", async () => {
    const { presence, store, nextWindow } = setup();
    for (let i = 0; i < 100; i++) await presence.beat("en");
    nextWindow();
    let reads = 0;
    const count = store.count.bind(store);
    store.count = async (...args) => (reads++, count(...args));
    for (let i = 0; i < 10; i++) await presence.beat("en");
    expect(reads).toBe(2); // en + es of the last window, once
    expect(await store.count("en", 11)).toBe(20); // p = 0.5: each counts 2
  });
});

describe("failures", () => {
  it("drops a heartbeat quietly when the table is too busy", async () => {
    const { presence, store } = setup();
    store.bump = async () => {
      throw Object.assign(new Error("throttled"), { name: "ProvisionedThroughputExceededException" });
    };
    await expect(presence.beat("en")).resolves.toBeUndefined();
  });

  it("but does not hide other errors", async () => {
    const { presence, store } = setup();
    store.bump = async () => {
      throw new Error("access denied");
    };
    await expect(presence.beat("en")).rejects.toThrow("access denied");
  });
});
