import type { Language, Match, Store } from "./types";

/**
 * In-memory Store for tests and local dev. Every operation is atomic like a DynamoDB conditional write;
 * with `yieldBetweenOps` each one also yields to other callers first, so concurrent requests interleave
 * between operations the way separate Lambda invocations do.
 */
export class MemoryStore implements Store {
  private queue = new Map<Language, string>();
  private matches = new Map<string, Match>();

  constructor(private readonly options: { yieldBetweenOps?: boolean } = {}) {}

  private async turn() {
    if (this.options.yieldBetweenOps) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  async takeQueue(lang: Language) {
    await this.turn();
    const id = this.queue.get(lang) ?? null;
    this.queue.delete(lang);
    return id;
  }

  async putQueue(lang: Language, matchId: string) {
    await this.turn();
    if (this.queue.has(lang)) return false;
    this.queue.set(lang, matchId);
    return true;
  }

  async clearQueue(lang: Language, matchId: string) {
    await this.turn();
    if (this.queue.get(lang) === matchId) this.queue.delete(lang);
  }

  async get(id: string, _consistent?: boolean) {
    await this.turn();
    const match = this.matches.get(id);
    return match ? { ...match } : null;
  }

  async create(match: Match) {
    await this.turn();
    if (this.matches.has(match.id)) throw new Error(`match ${match.id} exists`);
    this.matches.set(match.id, { ...match });
  }

  async claim(id: string, guest: string, seeds: { host: number; guest: number }, now: number) {
    await this.turn();
    const match = this.matches.get(id);
    if (!match || match.status !== "waiting" || match.guest) return null;
    Object.assign(match, { guest, status: "paired", seedHost: seeds.host, seedGuest: seeds.guest, guestSeen: now });
    return { ...match };
  }

  async update(id: string, fields: Partial<Match>) {
    await this.turn();
    const match = this.matches.get(id);
    if (match) Object.assign(match, fields);
  }

  async delete(id: string) {
    await this.turn();
    this.matches.delete(id);
  }

  // ---- test helpers ----

  matchCount() {
    return this.matches.size;
  }

  queued(lang: Language) {
    return this.queue.get(lang) ?? null;
  }
}
