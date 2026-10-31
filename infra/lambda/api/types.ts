import type { IceReport } from "./iceReport";

export type Language = "en" | "es";
export type MatchKind = "public" | "private";

/** One Match being set up, from the first player waiting until both are connected. */
export interface Match {
  id: string;
  lang: Language;
  kind: MatchKind;
  /** The waiter: makes the WebRTC offer after pairing. Anonymous player ids. */
  host: string;
  guest?: string;
  /** `ended`: someone left. Kept a day for debugging connections, but over for everyone. */
  status: "waiting" | "paired" | "ended";
  /** Hash of the word lists the host loaded; both players use it. */
  listVersion: string;
  /** Issued at pairing; each player's Attack words come from their own seed. */
  seedHost?: number;
  seedGuest?: number;
  offer?: string;
  answer?: string;
  /** Last time each player polled (ms). Liveness is checked against this, never against TTL. */
  hostSeen: number;
  guestSeen?: number;
  hostConnected?: boolean;
  guestConnected?: boolean;
  /** Each player's view of a connection attempt that didn't open (`at`: when it was saved, ms). */
  hostIce?: IceReport & { at: number };
  guestIce?: IceReport & { at: number };
  /** Who left first, and when (ms). Set once, when the match ends. */
  endedBy?: "host" | "guest";
  endedAt?: number;
  /** Epoch seconds. DynamoDB deletes lag, so this is cleanup only. */
  ttl: number;
}

/**
 * The few atomic operations matchmaking needs, so the rules run the same over memory (tests, local dev)
 * and DynamoDB (conditional writes).
 */
export interface Store {
  /** Removes the waiting pointer for this language and returns the match it pointed to. */
  takeQueue(lang: Language): Promise<string | null>;
  /** Sets the pointer only if there is none. False = someone else is already waiting. */
  putQueue(lang: Language, matchId: string): Promise<boolean>;
  /** Removes the pointer only if it still points to this match. */
  clearQueue(lang: Language, matchId: string): Promise<void>;
  /** `consistent: false` is a cheaper read that may be a moment stale; fine for polling. */
  get(id: string, consistent?: boolean): Promise<Match | null>;
  /** Fails if the id exists. */
  create(match: Match): Promise<void>;
  /** Pairs `guest` in, only if the match is still waiting with no guest. Null = lost the race. */
  claim(id: string, guest: string, seeds: { host: number; guest: number }, now: number): Promise<Match | null>;
  /** Sets fields on an existing match; does nothing if it is gone. */
  update(id: string, fields: Partial<Match>): Promise<void>;
  delete(id: string): Promise<void>;
}
