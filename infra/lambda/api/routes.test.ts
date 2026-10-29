import { describe, expect, it } from "vitest";
import { MemoryStore } from "./memoryStore";
import { createRouter, type HttpRequest } from "./routes";
import { Matchmaker } from "./service";

const A = "player-aaaaaaaaaaaaaaaa";
const B = "player-bbbbbbbbbbbbbbbb";
const VERSION = "wl-1234abcd";

function setup() {
  const route = createRouter(new Matchmaker(new MemoryStore()));
  const call = (method: string, path: string, body?: unknown, query: HttpRequest["query"] = {}) =>
    route({ method, path, query, body });
  return { call };
}

describe('a Public match over HTTP', () => {
  it('walks queue → pair → offer → answer → connected', async () => {
    const { call } = setup();
    const host = await call("POST", "/api/queue", { pid: A, lang: "en", listVersion: VERSION });
    expect(host.status).toBe(200);
    const id = (host.body as { matchId: string }).matchId;

    const guest = await call("POST", "/api/queue", { pid: B, lang: "en", listVersion: VERSION });
    expect(guest.body).toMatchObject({ matchId: id, role: "guest", status: "paired" });

    expect((await call("GET", `/api/match/${id}`, undefined, { pid: A })).body).toMatchObject({ status: "paired" });
    expect((await call("POST", `/api/match/${id}/signal`, { pid: A, type: "offer", sdp: "o" })).status).toBe(200);
    expect((await call("GET", `/api/match/${id}`, undefined, { pid: B })).body).toMatchObject({ offer: "o" });
    expect((await call("POST", `/api/match/${id}/signal`, { pid: B, type: "answer", sdp: "a" })).status).toBe(200);
    expect((await call("GET", `/api/match/${id}`, undefined, { pid: A })).body).toMatchObject({ answer: "a" });
    expect((await call("POST", `/api/match/${id}/connected`, { pid: A })).body).toMatchObject({ bothConnected: false });
    expect((await call("POST", `/api/match/${id}/leave`, { pid: A })).status).toBe(200);
    expect((await call("GET", `/api/match/${id}`, undefined, { pid: B })).status).toBe(404);
  });

  it('a Private match: create, then join with the id from the link', async () => {
    const { call } = setup();
    const made = await call("POST", "/api/match", { pid: A, lang: "es", listVersion: VERSION });
    const id = (made.body as { matchId: string }).matchId;
    expect((await call("POST", `/api/match/${id}/join`, { pid: B })).body).toMatchObject({ role: "guest", lang: "es" });
    expect((await call("POST", `/api/match/${id}/join`, { pid: "player-cccccccccccccccc" })).body).toEqual({ error: "full" });
  });
});

describe('validation', () => {
  const bad: Array<[string, string, string, unknown]> = [
    ["no body", "POST", "/api/queue", undefined],
    ["a body that is not an object", "POST", "/api/queue", "hi"],
    ["a short player id", "POST", "/api/queue", { pid: "abc", lang: "en", listVersion: VERSION }],
    ["a player id with odd characters", "POST", "/api/queue", { pid: "x".repeat(15) + "!", lang: "en", listVersion: VERSION }],
    ["an unknown language", "POST", "/api/queue", { pid: A, lang: "fr", listVersion: VERSION }],
    ["a missing list version", "POST", "/api/queue", { pid: A, lang: "en" }],
    ["a list version with odd characters", "POST", "/api/queue", { pid: A, lang: "en", listVersion: "a b" }],
    ["a list version that is too long", "POST", "/api/match", { pid: A, lang: "en", listVersion: "a".repeat(65) }],
    ["a bad match id", "POST", "/api/match/NOPE!/join", { pid: A }],
    ["a missing player id on poll", "GET", "/api/match/abcdefghij", undefined],
    ["a signal that is neither offer nor answer", "POST", "/api/match/abcdefghij/signal", { pid: A, type: "ice", sdp: "x" }],
    ["a signal with a non-string description", "POST", "/api/match/abcdefghij/signal", { pid: A, type: "offer", sdp: 5 }],
  ];
  it.each(bad)('rejects %s with 400', async (_name, method, path, body) => {
    const { call } = setup();
    const query = method === "GET" ? {} : {};
    const res = await call(method, path, body, query);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid" });
  });

  it('ignores unknown extra fields', async () => {
    const { call } = setup();
    const res = await call("POST", "/api/queue", { pid: A, lang: "en", listVersion: VERSION, extra: "x".repeat(10) });
    expect(res.status).toBe(200);
  });
});

describe('routing', () => {
  it('answers /api/ping', async () => {
    const { call } = setup();
    const res = await call("GET", "/api/ping");
    expect(res).toMatchObject({ status: 200, body: { ok: true } });
  });

  it('404s unknown routes and 405s the wrong method on a known one', async () => {
    const { call } = setup();
    expect((await call("GET", "/api/nothing")).status).toBe(404);
    expect((await call("GET", "/api/queue")).status).toBe(405);
    expect((await call("DELETE", "/api/match/abcdefghij")).status).toBe(405);
  });

  it('never leaks internals on an unexpected error', async () => {
    const mm = new Matchmaker(new MemoryStore());
    mm.queue = async () => {
      throw new Error("table secret-arn is on fire");
    };
    const res = await createRouter(mm)({ method: "POST", path: "/api/queue", query: {}, body: { pid: A, lang: "en", listVersion: VERSION } });
    expect(res).toEqual({ status: 500, body: { error: "internal" } });
  });
});
