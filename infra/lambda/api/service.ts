import { randomBytes } from "node:crypto";
import { parseIceReport } from "./iceReport";
import type { Language, Match, MatchKind, Store } from "./types";

/** A waiter or opponent who hasn't polled for this long is gone. */
export const STALE_MS = 10_000;
/** Polls bump liveness at most this often, to save writes. */
const TOUCH_MS = 4000;
const MAX_ATTEMPTS = 3;
const TTL_SECONDS = 3600;
/** Once both players are connected nothing more is needed from the item. */
const DONE_TTL_SECONDS = 120;
/** An ended match (with its offer, answer and ICE reports) stays this long, to debug failed connections. */
const ENDED_TTL_SECONDS = 24 * 3600;
export const MAX_SDP_BYTES = 8192;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

/** What a player sees of a match. `offer` goes to the guest, `answer` to the host. */
export interface MatchView {
  matchId: string;
  role: "host" | "guest";
  status: "waiting" | "paired";
  kind: MatchKind;
  lang: Language;
  listVersion: string;
  seeds?: { mine: number; theirs: number };
  offer?: string;
  answer?: string;
  /** Paired, but the other player stopped polling. */
  opponentGone: boolean;
  bothConnected: boolean;
}

export interface MatchmakerDeps {
  now: () => number;
  newId: () => string;
  random32: () => number;
}

const ID_ALPHABET = "abcdefghjkmnpqrstvwxyz23456789";
const defaults: MatchmakerDeps = {
  now: () => Date.now(),
  newId: () => Array.from(randomBytes(12), (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join(""),
  random32: () => randomBytes(4).readUInt32BE(),
};

export class Matchmaker {
  private readonly deps: MatchmakerDeps;

  constructor(
    private readonly store: Store,
    deps: Partial<MatchmakerDeps> = {},
  ) {
    this.deps = { ...defaults, ...deps };
  }

  /** Public match: pair with the player waiting in this language, or become the one waiting. */
  async queue(pid: string, lang: Language, listVersion: string): Promise<MatchView> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const waitingId = await this.store.takeQueue(lang);
      if (waitingId) {
        const waiter = await this.store.get(waitingId);
        if (waiter && waiter.status === "waiting" && !waiter.guest) {
          if (waiter.host === pid) {
            // Their own earlier search (second tab, refresh): keep waiting on it.
            await this.store.putQueue(lang, waitingId);
            return this.view(waiter, pid);
          }
          if (!this.isStale(waiter.hostSeen)) {
            const paired = await this.store.claim(waitingId, pid, this.seeds(), this.deps.now());
            if (paired) return this.view(paired, pid);
            continue; // someone else got them first
          }
          await this.store.delete(waitingId); // left without a word: quiet cancel
        }
      }
      const mine = this.newMatch(pid, lang, "public", listVersion);
      await this.store.create(mine);
      if (await this.store.putQueue(lang, mine.id)) return this.view(mine, pid);
      await this.store.delete(mine.id); // another searcher queued first: go take theirs
    }
    throw new ApiError(503, "busy");
  }

  /** Private match: waits for a friend with the Invite link, never enters the queue. */
  async createPrivate(pid: string, lang: Language, listVersion: string): Promise<MatchView> {
    const match = this.newMatch(pid, lang, "private", listVersion);
    await this.store.create(match);
    return this.view(match, pid);
  }

  async join(pid: string, matchId: string): Promise<MatchView> {
    const match = await this.store.get(matchId);
    if (!match || match.status === "ended") throw new ApiError(404, "expired");
    if (match.guest === pid) return this.view(match, pid);
    if (match.host === pid) throw new ApiError(409, "own");
    if (match.guest || match.status === "paired") throw new ApiError(409, "full");
    if (this.isStale(match.hostSeen)) throw new ApiError(404, "expired");
    const paired = await this.store.claim(matchId, pid, this.seeds(), this.deps.now());
    if (!paired) throw new ApiError(409, "full");
    return this.view(paired, pid);
  }

  async poll(pid: string, matchId: string): Promise<MatchView> {
    const match = await this.mine(pid, matchId, false);
    const key = match.host === pid ? "hostSeen" : "guestSeen";
    const now = this.deps.now();
    if (now - (match[key] ?? 0) >= TOUCH_MS) {
      match[key] = now;
      await this.store.update(matchId, { [key]: now });
    }
    return this.view(match, pid);
  }

  async signal(pid: string, matchId: string, type: "offer" | "answer", sdp: string): Promise<void> {
    if (typeof sdp !== "string" || sdp.length === 0) throw new ApiError(400, "invalid");
    if (Buffer.byteLength(sdp) > MAX_SDP_BYTES) throw new ApiError(413, "too_large");
    const match = await this.mine(pid, matchId);
    if (match.status !== "paired") throw new ApiError(409, "not_paired");
    if (type === "offer") {
      if (match.host !== pid) throw new ApiError(403, "forbidden");
      await this.store.update(matchId, { offer: sdp });
    } else {
      if (match.guest !== pid) throw new ApiError(403, "forbidden");
      if (!match.offer) throw new ApiError(409, "no_offer");
      await this.store.update(matchId, { answer: sdp });
    }
  }

  async connected(pid: string, matchId: string): Promise<MatchView> {
    const match = await this.mine(pid, matchId);
    const fields: Partial<Match> = match.host === pid ? { hostConnected: true } : { guestConnected: true };
    Object.assign(match, fields);
    if (match.hostConnected && match.guestConnected) fields.ttl = match.ttl = this.ttl(DONE_TTL_SECONDS);
    await this.store.update(matchId, fields);
    return this.view(match, pid);
  }

  /** Saves this player's ICE report (why the connection didn't open). Accepted on an ended match too. */
  async ice(pid: string, matchId: string, report: unknown): Promise<void> {
    const match = await this.store.get(matchId);
    if (!match) throw new ApiError(404, "gone");
    if (match.host !== pid && match.guest !== pid) throw new ApiError(403, "forbidden");
    const saved = { ...parseIceReport(report), at: this.deps.now() };
    await this.store.update(matchId, match.host === pid ? { hostIce: saved } : { guestIce: saved });
  }

  /**
   * Leaves quietly: a waiting host also takes their queue pointer; a paired match ends for both. The item is
   * kept (ended) for a day so a failed connection can be looked at; nobody can poll, join or pair with it.
   */
  async leave(pid: string, matchId: string): Promise<void> {
    const match = await this.store.get(matchId);
    if (!match || match.status === "ended" || (match.host !== pid && match.guest !== pid)) return;
    if (match.status === "waiting" && match.kind === "public") await this.store.clearQueue(match.lang, matchId);
    await this.store.update(matchId, {
      status: "ended",
      endedBy: match.host === pid ? "host" : "guest",
      endedAt: this.deps.now(),
      ttl: this.ttl(ENDED_TTL_SECONDS),
    });
  }

  // ---- internals ----

  private async mine(pid: string, matchId: string, consistent = true): Promise<Match> {
    const match = await this.store.get(matchId, consistent);
    if (!match || match.status === "ended") throw new ApiError(404, "gone");
    if (match.host !== pid && match.guest !== pid) throw new ApiError(403, "forbidden");
    return match;
  }

  private isStale(seen: number | undefined) {
    return this.deps.now() - (seen ?? 0) > STALE_MS;
  }

  private seeds() {
    return { host: this.deps.random32(), guest: this.deps.random32() };
  }

  private ttl(seconds = TTL_SECONDS) {
    return Math.floor(this.deps.now() / 1000) + seconds;
  }

  private newMatch(host: string, lang: Language, kind: MatchKind, listVersion: string): Match {
    return { id: this.deps.newId(), lang, kind, host, status: "waiting", listVersion, hostSeen: this.deps.now(), ttl: this.ttl() };
  }

  private view(match: Match, pid: string): MatchView {
    const role = match.host === pid ? "host" : "guest";
    const paired = match.status === "paired";
    const theirSeen = role === "host" ? match.guestSeen : match.hostSeen;
    return {
      matchId: match.id,
      role,
      // Never `ended` here: every caller refuses an ended match before building a view.
      status: match.status as MatchView["status"],
      kind: match.kind,
      lang: match.lang,
      listVersion: match.listVersion,
      seeds: paired
        ? role === "host"
          ? { mine: match.seedHost!, theirs: match.seedGuest! }
          : { mine: match.seedGuest!, theirs: match.seedHost! }
        : undefined,
      offer: role === "guest" ? match.offer : undefined,
      answer: role === "host" ? match.answer : undefined,
      opponentGone: paired && this.isStale(theirSeen),
      bothConnected: !!(match.hostConnected && match.guestConnected),
    };
  }
}
