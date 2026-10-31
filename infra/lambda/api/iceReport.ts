import { ApiError } from "./service";

/**
 * One browser's view of a connection attempt that didn't open, from `RTCPeerConnection.getStats()`: every
 * candidate (address) both sides had, and every pair tried between them with its checks. Saved on the match
 * item (ended matches live a day), to tell why two players couldn't connect. Holds IP addresses.
 */
export interface IceReport {
  fail: "timeout" | "iceFailed" | "signalingLost" | "aborted";
  /** Milliseconds from the start of the attempt. */
  ms: number;
  /** `iceConnectionState` and `iceGatheringState` at the end. */
  ice: string;
  gathering: string;
  cands: IceCandidate[];
  /** `local` and `remote` are indexes into `cands`. */
  pairs: IcePair[];
}

export interface IceCandidate {
  side: "local" | "remote";
  type: "host" | "srflx" | "prflx" | "relay";
  /** IP, or an mDNS `.local` name (Chrome hides local IPs); null when the browser won't say. */
  address: string | null;
  port: number | null;
  protocol: "udp" | "tcp" | null;
}

export interface IcePair {
  local: number;
  remote: number;
  state: "frozen" | "waiting" | "in-progress" | "failed" | "succeeded";
  nominated: boolean;
  requestsSent: number;
  responsesReceived: number;
  requestsReceived: number;
  responsesSent: number;
}

export const MAX_ICE_CANDIDATES = 30;
export const MAX_ICE_PAIRS = 50;

const invalid = () => new ApiError(400, "invalid");

const record = (v: unknown) => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw invalid();
  return v as Record<string, unknown>;
};
const oneOf = <T extends string>(v: unknown, ...values: T[]) => {
  if (!values.includes(v as T)) throw invalid();
  return v as T;
};
const int = (v: unknown, max: number) => {
  if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > max) throw invalid();
  return v as number;
};
const list = (v: unknown, max: number) => {
  if (!Array.isArray(v) || v.length > max) throw invalid();
  return v as unknown[];
};
const nullable = <T>(v: unknown, check: (v: unknown) => T) => (v === null || v === undefined ? null : check(v));

/** IPv4, IPv6 (with zone) or an mDNS name. */
const ADDRESS = /^[A-Za-z0-9.:%-]{1,100}$/;
const ICE_STATES = ["new", "checking", "connected", "completed", "failed", "disconnected", "closed"] as const;
const GATHERING_STATES = ["new", "gathering", "complete"] as const;
const COUNT_MAX = 1_000_000;

/** The clean report, keeping only known fields; `invalid` (400) for anything else. */
export function parseIceReport(value: unknown): IceReport {
  const r = record(value);
  const cands = list(r.cands, MAX_ICE_CANDIDATES).map((c): IceCandidate => {
    const cand = record(c);
    return {
      side: oneOf(cand.side, "local", "remote"),
      type: oneOf(cand.type, "host", "srflx", "prflx", "relay"),
      address: nullable(cand.address, (a) => {
        if (typeof a !== "string" || !ADDRESS.test(a)) throw invalid();
        return a;
      }),
      port: nullable(cand.port, (p) => int(p, 65535)),
      protocol: nullable(cand.protocol, (p) => oneOf(p, "udp", "tcp")),
    };
  });
  const index = (v: unknown) => int(v, cands.length - 1);
  const pairs = list(r.pairs, MAX_ICE_PAIRS).map((p): IcePair => {
    const pair = record(p);
    if (typeof pair.nominated !== "boolean") throw invalid();
    return {
      local: index(pair.local),
      remote: index(pair.remote),
      state: oneOf(pair.state, "frozen", "waiting", "in-progress", "failed", "succeeded"),
      nominated: pair.nominated,
      requestsSent: int(pair.requestsSent, COUNT_MAX),
      responsesReceived: int(pair.responsesReceived, COUNT_MAX),
      requestsReceived: int(pair.requestsReceived, COUNT_MAX),
      responsesSent: int(pair.responsesSent, COUNT_MAX),
    };
  });
  return {
    fail: oneOf(r.fail, "timeout", "iceFailed", "signalingLost", "aborted"),
    ms: int(r.ms, 24 * 3600 * 1000),
    ice: oneOf(r.ice, ...ICE_STATES),
    gathering: oneOf(r.gathering, ...GATHERING_STATES),
    cands,
    pairs,
  };
}
