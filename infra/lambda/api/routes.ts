import { ApiError, type Matchmaker } from "./service";
import type { Language } from "./types";

export interface HttpRequest {
  method: string;
  path: string;
  query: Record<string, string | undefined>;
  /** Parsed JSON, or undefined if there was none. */
  body: unknown;
}

export interface HttpResponse {
  status: number;
  body: unknown;
}

const PID = /^[A-Za-z0-9_-]{16,64}$/;
const MATCH_ID = /^[a-z0-9]{3,32}$/;
const LIST_VERSION = /^[A-Za-z0-9_.-]{1,64}$/;
const invalid = () => new ApiError(400, "invalid");

function fields(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw invalid();
  return body as Record<string, unknown>;
}

function pid(value: unknown): string {
  if (typeof value !== "string" || !PID.test(value)) throw invalid();
  return value;
}

function lang(value: unknown): Language {
  if (value !== "en" && value !== "es") throw invalid();
  return value;
}

function listVersion(value: unknown): string {
  if (typeof value !== "string" || !LIST_VERSION.test(value)) throw invalid();
  return value;
}

function matchId(value: string): string {
  if (!MATCH_ID.test(value)) throw invalid();
  return value;
}

const ok = (body: unknown): HttpResponse => ({ status: 200, body });

/** Maps HTTP requests to the Matchmaker: strict validation in, JSON out, no internals in errors. */
export function createRouter(mm: Matchmaker) {
  return async function route(req: HttpRequest): Promise<HttpResponse> {
    try {
      return await dispatch(mm, req);
    } catch (error) {
      if (error instanceof ApiError) return { status: error.status, body: { error: error.code } };
      console.error(JSON.stringify({ event: "api_error", message: error instanceof Error ? error.message : String(error) }));
      return { status: 500, body: { error: "internal" } };
    }
  };
}

async function dispatch(mm: Matchmaker, { method, path, query, body }: HttpRequest): Promise<HttpResponse> {
  const only = (allowed: string) => {
    if (method !== allowed) throw new ApiError(405, "method_not_allowed");
  };

  if (path === "/api/ping") {
    only("GET");
    return ok({ ok: true, now: Date.now() });
  }
  if (path === "/api/queue") {
    only("POST");
    const b = fields(body);
    return ok(await mm.queue(pid(b.pid), lang(b.lang), listVersion(b.listVersion)));
  }
  if (path === "/api/match") {
    only("POST");
    const b = fields(body);
    return ok(await mm.createPrivate(pid(b.pid), lang(b.lang), listVersion(b.listVersion)));
  }

  const match = /^\/api\/match\/([^/]+)(?:\/(join|signal|connected|leave))?$/.exec(path);
  if (!match) throw new ApiError(404, "not_found");
  const id = matchId(match[1]);
  switch (match[2]) {
    case undefined:
      only("GET");
      return ok(await mm.poll(pid(query.pid), id));
    case "join":
      only("POST");
      return ok(await mm.join(pid(fields(body).pid), id));
    case "signal": {
      only("POST");
      const b = fields(body);
      if (b.type !== "offer" && b.type !== "answer") throw invalid();
      if (typeof b.sdp !== "string") throw invalid();
      await mm.signal(pid(b.pid), id, b.type, b.sdp);
      return ok({ ok: true });
    }
    case "connected":
      only("POST");
      return ok(await mm.connected(pid(fields(body).pid), id));
    default:
      only("POST");
      await mm.leave(pid(fields(body).pid), id);
      return ok({ ok: true });
  }
}
