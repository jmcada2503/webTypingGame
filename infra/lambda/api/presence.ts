import type { Language } from "./types";

/** Every open tab heartbeats once per window; the count is the last complete window. */
export const BUCKET_MS = 30_000;
const LANGUAGES: Language[] = ["en", "es"];

/** One counter per language per window. */
export interface PresenceStore {
  bump(lang: Language, window: number): Promise<void>;
  count(lang: Language, window: number): Promise<number>;
}

export class MemoryPresenceStore implements PresenceStore {
  private counts = new Map<string, number>();

  async bump(lang: Language, window: number) {
    const key = `${lang}#${window}`;
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  async count(lang: Language, window: number) {
    return this.counts.get(`${lang}#${window}`) ?? 0;
  }
}

export interface OnlineCount {
  en: number;
  es: number;
  total: number;
  /** The window the count is from (ms since epoch / 30 000). */
  window: number;
}

/**
 * Players online, per language. A heartbeat adds 1 to the current 30 s window; `online()` reads the window
 * before it (complete, so it isn't half counted). Each reported count is logged: the peak over a time range
 * is a Logs Insights `max(total)`.
 */
export class Presence {
  private readonly now: () => number;
  private readonly log: (entry: Record<string, unknown>) => void;

  constructor(
    private readonly store: PresenceStore,
    deps: { now?: () => number; log?: (entry: Record<string, unknown>) => void } = {},
  ) {
    this.now = deps.now ?? (() => Date.now());
    this.log = deps.log ?? ((entry) => console.log(JSON.stringify(entry)));
  }

  async beat(lang: Language): Promise<void> {
    try {
      await this.store.bump(lang, this.window());
    } catch (error) {
      // The table is provisioned to stay free: past its write rate a heartbeat is just not counted.
      if ((error as { name?: string }).name === "ProvisionedThroughputExceededException") return;
      throw error;
    }
  }

  async online(): Promise<OnlineCount> {
    const window = this.window() - 1;
    const [en, es] = await Promise.all(LANGUAGES.map((lang) => this.store.count(lang, window)));
    const count = { en, es, total: en + es, window };
    this.log({ event: "online_count", ...count });
    return count;
  }

  private window() {
    return Math.floor(this.now() / BUCKET_MS);
  }
}
