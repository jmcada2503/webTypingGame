// What the browser reports to `POST /api/report`. Mirrors the checks in `infra/lambda/api/metrics.ts`
// (field names are short: one log line per record, kept for half a year).
import type { Language, MatchKind } from '../flow/types';

/** Where it ran: browser family, OS family, and whether this browser played on an earlier day. */
export interface ClientInfo {
  br: string;
  os: string;
  ret: boolean;
}

interface Typing {
  lang: Language;
  /** When it ended (ms). With the id it keys the history item, so a retry is a duplicate. */
  at: number;
  /** Seconds played. */
  dur: number;
  /** Average and highest Pace (letters per second), and words per minute. */
  pace: number;
  peak: number;
  wpm: number;
  /** Right submits / all submits; null when nothing was submitted. */
  acc: number | null;
  words: number;
  letters: number;
  wrong: number;
  /** Words of the Word bullets that reached me (at most 10). */
  missed: string[];
}

export type MatchEnding = 'won' | 'lost' | 'peace' | 'opponentLeft' | 'quit';

export interface MatchRecord extends Typing {
  t: 'match';
  mid: string;
  /** 0 the first Match on this connection, then 1, 2... for each Rematch. */
  n: number;
  kind: MatchKind;
  end: MatchEnding;
  /** Word bullets destroyed / arrived; Shots fired / hit / defended. */
  bd: number;
  ba: number;
  sf: number;
  sh: number;
  sd: number;
  lives: number;
  attacks: { i: number; w: string; t: number; o: 'hit' | 'defended' | 'flying' }[];
  /** Matchmaking wait (ms) before the first Match; null for Rematches. */
  wait: number | null;
  howto: 'skipped' | 'auto' | null;
  rtt: number | null;
  /** Opponent Shots the seed check rejected / let through only thanks to the latency slack. */
  invalid: number;
  near: number;
}

export interface PracticeRecord extends Typing {
  t: 'practice';
  rid: string;
  active: number;
  calib: number | null;
  start: number | null;
  level: number | null;
}

export interface P2pRecord {
  t: 'p2p';
  mid: string;
  kind: MatchKind;
  role: 'host' | 'guest';
  ok: boolean;
  fail: 'iceFailed' | 'timeout' | 'signalingLost' | 'peerLeft' | 'graceExpired' | 'aborted' | null;
  pair: 'host' | 'srflx' | 'prflx' | 'relay' | null;
  /** Time to connect, and to gather candidates (ms). */
  ms: number | null;
  gather: number | null;
  ice: { s: string; ms: number }[];
  /** Candidates offered: l/r = local/remote, h/s/r = host/srflx/relay. */
  cand: { lh: number; ls: number; lr: number; rh: number; rs: number; rr: number };
}

/** I gave up on Matchmaking: left the waiting screen (`left`), or the servers went resting meanwhile. */
export interface MmRecord {
  t: 'mm';
  kind: MatchKind;
  lang: Language;
  wait: number;
  why: 'left' | 'error' | 'resting';
}

/** How the Rematch offer after Match `n` was settled. `closed`: nobody proposed before it went away. */
export interface RematchRecord {
  t: 'rematch';
  mid: string;
  kind: MatchKind;
  n: number;
  out: 'played' | 'declined' | 'expired' | 'left' | 'closed';
}

/** What the tracker hands the reporter; the reporter adds the client info. */
export type MetricRecord = MatchRecord | PracticeRecord | P2pRecord | MmRecord | RematchRecord;
