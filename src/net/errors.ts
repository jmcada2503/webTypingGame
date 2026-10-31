/**
 * Why a connection failed or ended.
 * `iceFailed`: no network path to the opponent. `timeout`: it took too long to connect.
 * `signalingLost`: the line through the backend died before the channel opened.
 * `peerLeft`: the opponent closed it. `graceExpired`: they went silent past the grace.
 * `aborted`: we gave up on purpose (the player left).
 */
export type TransportErrorKind = 'iceFailed' | 'timeout' | 'signalingLost' | 'peerLeft' | 'graceExpired' | 'aborted';

/** What one connection attempt did, for the metrics (kept even when it failed). */
export interface ConnectionRecord {
  role: 'host' | 'guest';
  /** ICE connection states in order, with milliseconds since the attempt started. */
  iceTimeline: { atMs: number; state: string }[];
  /** When candidate gathering finished (null if it hadn't). */
  gatherMs: number | null;
  /** Kind of path chosen: relay beats srflx beats host. Null until connected. */
  pairType: 'host' | 'srflx' | 'prflx' | 'relay' | null;
  /** Milliseconds from start to the channel opening (null if it never did). */
  connectMs: number | null;
  failure: TransportErrorKind | null;
  browser: string;
  /** Candidates each side offered, by type: tells "STUN blocked" (no srflx) from "no path between them". */
  candidates: { local: CandidateCount; remote: CandidateCount };
  /** What ICE saw when the attempt failed (null on success, or if the browser wouldn't say). Holds IPs. */
  ice: IceReport | null;
}

/** The ways a connection attempt can end before the channel opens. */
export type ConnectFailure = Extract<TransportErrorKind, 'timeout' | 'iceFailed' | 'signalingLost' | 'aborted'>;

/**
 * Why a connection attempt didn't open, from `getStats()`: every candidate (address) both sides had and every
 * pair tried between them. Saved on the match (mirrors `infra/lambda/api/iceReport.ts`).
 */
export interface IceReport {
  fail: ConnectFailure;
  /** Milliseconds from the start of the attempt. */
  ms: number;
  ice: string;
  gathering: string;
  cands: IceCandidate[];
  /** `local` and `remote` are indexes into `cands`. */
  pairs: IcePair[];
}

export interface IceCandidate {
  side: 'local' | 'remote';
  type: 'host' | 'srflx' | 'prflx' | 'relay';
  /** IP, or an mDNS `.local` name (Chrome hides local IPs). */
  address: string | null;
  port: number | null;
  protocol: 'udp' | 'tcp' | null;
}

export interface IcePair {
  local: number;
  remote: number;
  state: 'frozen' | 'waiting' | 'in-progress' | 'failed' | 'succeeded';
  nominated: boolean;
  requestsSent: number;
  responsesReceived: number;
  requestsReceived: number;
  responsesSent: number;
}

export interface CandidateCount {
  host: number;
  srflx: number;
  relay: number;
}

export class TransportError extends Error {
  constructor(
    readonly kind: TransportErrorKind,
    readonly record: ConnectionRecord,
  ) {
    super(`P2P connection failed: ${kind}`);
  }
}
