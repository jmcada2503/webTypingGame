import type { Language } from "./types";

/** Every open tab heartbeats (at most) once per window; the count is the last complete window. */
export const BUCKET_MS = 60_000;
/**
 * Above this many tabs, only a share of them heartbeat (`sample = SAMPLE_TARGET / total`) and each heartbeat
 * counts for 1 / sample: about this many requests per window however many players are online.
 */
export const SAMPLE_TARGET = 50;
const LANGUAGES: Language[] = ["en", "es"];

/** One counter per language per window; `amount` is the heartbeat's weight (1 / sample). */
export interface PresenceStore {
  bump(lang: Language, window: number, amount: number): Promise<void>;
  count(lang: Language, window: number): Promise<number>;
}

export class MemoryPresenceStore implements PresenceStore {
  private counts = new Map<string, number>();

  async bump(lang: Language, window: number, amount: number) {
    const key = `${lang}#${window}`;
    this.counts.set(key, (this.counts.get(key) ?? 0) + amount);
  }

  async count(lang: Language, window: number) {
    return this.counts.get(`${lang}#${window}`) ?? 0;
  }
}

export interface OnlineCount {
  en: number;
  es: number;
  total: number;
  /** The window the count is from (ms since epoch / 60 000). */
  window: number;
  /** The share of tabs that should heartbeat in the next window (1 = all). */
  sample: number;
}

const sampleFor = (total: number) => Math.min(1, SAMPLE_TARGET / Math.max(total, 1));

/**
 * Players online, per language. A heartbeat adds its weight to the current window; `online()` reads the window
 * before it (complete, so it isn't half counted). The sampling rate for a window comes from the window before
 * it, worked out here (cached once per window), never taken from the client. Each reported count is logged:
 * the peak over a time range is a Logs Insights `max(total)`.
 */
export class Presence {
  private readonly now: () => number;
  private readonly log: (entry: Record<string, unknown>) => void;
  private rate: { window: number; sample: number } | null = null;

  constructor(
    private readonly store: PresenceStore,
    deps: { now?: () => number; log?: (entry: Record<string, unknown>) => void } = {},
  ) {
    this.now = deps.now ?? (() => Date.now());
    this.log = deps.log ?? ((entry) => console.log(JSON.stringify(entry)));
  }

  async beat(lang: Language): Promise<void> {
    const window = this.window();
    try {
      await this.store.bump(lang, window, 1 / (await this.sampleIn(window)));
    } catch (error) {
      // The table is provisioned to stay free: past its write rate a heartbeat is just not counted.
      if ((error as { name?: string }).name === "ProvisionedThroughputExceededException") return;
      throw error;
    }
  }

  async online(): Promise<OnlineCount> {
    const window = this.window() - 1;
    const [en, es] = await this.counts(window);
    const count = { en, es, total: en + es, window, sample: sampleFor(en + es) };
    this.log({ event: "online_count", ...count });
    return count;
  }

  /** The rate tabs were asked to use during `window`: from the count of the window before it. */
  private async sampleIn(window: number) {
    if (this.rate?.window !== window) {
      const [en, es] = await this.counts(window - 1);
      this.rate = { window, sample: sampleFor(en + es) };
    }
    return this.rate.sample;
  }

  private async counts(window: number) {
    const counts = await Promise.all(LANGUAGES.map((lang) => this.store.count(lang, window)));
    return counts.map(Math.round);
  }

  private window() {
    return Math.floor(this.now() / BUCKET_MS);
  }
}
