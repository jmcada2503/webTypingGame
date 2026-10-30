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
