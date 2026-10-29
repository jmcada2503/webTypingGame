import { describe, expect, it } from "vitest";
import { BUCKET_MS, MemoryPresenceStore, Presence } from "./presence";

function setup() {
  const clock = { now: 10 * BUCKET_MS + 1000 };
  const store = new MemoryPresenceStore();
  const logs: unknown[] = [];
  const presence = new Presence(store, { now: () => clock.now, log: (e) => logs.push(e) });
  return { presence, store, clock, logs };
}

describe("presence", () => {
  it("counts each heartbeat in its 30 s window, per language", async () => {
    const { presence, store } = setup();
    await presence.beat("en");
    await presence.beat("en");
    await presence.beat("es");
    expect(await store.count("en", 10)).toBe(2);
    expect(await store.count("es", 10)).toBe(1);
  });

  it("reports the last complete window, not the one still filling", async () => {
    const { presence, clock } = setup();
    await presence.beat("en");
    await presence.beat("es");
    expect(await presence.online()).toMatchObject({ en: 0, es: 0, total: 0 });
    clock.now += BUCKET_MS;
    await presence.beat("en"); // the new window: not counted yet
    expect(await presence.online()).toMatchObject({ en: 1, es: 1, total: 2 });
  });

  it("forgets windows older than the last complete one", async () => {
    const { presence, clock } = setup();
    await presence.beat("en");
    clock.now += 2 * BUCKET_MS;
    expect((await presence.online()).total).toBe(0);
  });

  it("logs every count it reports, for the peak-players metric", async () => {
    const { presence, clock, logs } = setup();
    await presence.beat("en");
    clock.now += BUCKET_MS;
    await presence.online();
    expect(logs).toEqual([{ event: "online_count", en: 1, es: 0, total: 1, window: 10 }]);
  });

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
