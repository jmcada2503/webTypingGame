import { ApiError } from "./service";

/**
 * Collect-only metrics. The browser sends one record per thing that happened (`POST /api/report`):
 * - `match`: my side of an online Match, when it ends (every Rematch is its own Match).
 * - `practice`: one Practice run, when it ends.
 * - `p2p`: one connection attempt to an opponent, success or failure.
 * - `mm`: I gave up on Matchmaking (left the waiting screen before an opponent was found).
 * - `rematch`: how the Rematch offer after a Match was settled.
 *
 * Every record becomes one JSON log line (queried with Logs Insights). `match` and `practice` also become a
 * `match_details` item: the player's history, kept until accounts exist. No IP or full user agent is stored:
 * country, browser family and OS family only.
 */

/** Bumped when a field changes meaning, so queries can tell old lines from new. */
export const SCHEMA_VERSION = 1;
/** Words of the Word bullets that reached me (the hardest ones), at most. */
const MAX_MISSED = 10;
/** My Shots, one entry each, at most (a long Match fires ~60). */
const MAX_ATTACKS = 120;
const MAX_ICE_STATES = 20;

export type DetailsResult = "ok" | "duplicate" | "throttled";

/** The player's Match history: one item per player per Match or Practice run. */
export interface DetailsStore {
  /** Writes the item unless that (pid, sk) already exists. */
  put(item: { pid: string; sk: string } & Record<string, unknown>): Promise<DetailsResult>;
}

export interface MetricsDeps {
  store: DetailsStore;
  /** One JSON log line. */
  log: (line: Record<string, unknown>) => void;
  /** Share of reports kept, 0..1. 0 turns metrics off (kill switch). */
  sampleRate: number;
  random?: () => number;
}

type Rec = Record<string, unknown>;
const invalid = () => new ApiError(400, "invalid");

// ---- field checks: each returns the clean value or throws `invalid` ----

const num = (min: number, max: number) => (v: unknown) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw invalid();
  return Math.round(v * 1000) / 1000;
};
const int = (min: number, max: number) => (v: unknown) => {
  if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) throw invalid();
  return v as number;
};
const oneOf = <T extends string>(...values: T[]) => (v: unknown) => {
  if (!values.includes(v as T)) throw invalid();
  return v as T;
};
const text = (re: RegExp) => (v: unknown) => {
  if (typeof v !== "string" || !re.test(v)) throw invalid();
  return v;
};
const bool = (v: unknown) => {
  if (typeof v !== "boolean") throw invalid();
  return v;
};
const nullable = <T>(check: (v: unknown) => T) => (v: unknown) => (v === null || v === undefined ? null : check(v));
const list = <T>(max: number, check: (v: unknown) => T) => (v: unknown) => {
  if (!Array.isArray(v) || v.length > max) throw invalid();
  return v.map(check);
};
const shape = (spec: Record<string, (v: unknown) => unknown>) => (v: unknown) => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw invalid();
  const src = v as Rec;
  const out: Rec = {};
  for (const [key, check] of Object.entries(spec)) out[key] = check(src[key]);
  return out;
};

const ID = text(/^[a-z0-9]{3,32}$/);
const WORD = text(/^[\p{L}'-]{1,32}$/u);
const SECONDS = num(0, 24 * 3600);
const MS = int(0, 24 * 3600 * 1000);
const COUNT = int(0, 100_000);
const PACE = num(0, 100);
const LANG = oneOf("en", "es");
const KIND = oneOf("public", "private");
const SHARE = nullable(num(0, 1));
/** Client time the record was made (ms). Part of the history key, so a retry with the same body is a duplicate. */
const AT = int(1_700_000_000_000, 4_000_000_000_000);

/** Every record says where it ran. */
const CLIENT = {
  br: text(/^[A-Za-z]{1,16}$/),
  os: text(/^[A-Za-z]{1,16}$/),
  /** Played on an earlier day too (no joins in Logs Insights, so the browser says it). */
  ret: bool,
};

const TYPING = {
  lang: LANG,
  at: AT,
  dur: SECONDS,
  pace: PACE,
  peak: PACE,
  wpm: num(0, 1200),
  acc: SHARE,
  words: COUNT,
  letters: COUNT,
  wrong: COUNT,
  missed: list(MAX_MISSED, WORD),
};

const RECORDS = {
  match: shape({
    ...CLIENT,
    ...TYPING,
    mid: ID,
    /** Which Match on this connection: 0 the first, then each Rematch. */
    n: int(0, 999),
    kind: KIND,
    end: oneOf("won", "lost", "peace", "opponentLeft", "quit"),
    bd: COUNT,
    ba: COUNT,
    sf: COUNT,
    sh: COUNT,
    sd: COUNT,
    lives: int(0, 10),
    attacks: list(MAX_ATTACKS, shape({ i: int(0, 10_000_000), w: WORD, t: SECONDS, o: oneOf("hit", "defended", "flying") })),
    /** Matchmaking wait before this Match (first Match only; Rematches have none). */
    wait: nullable(MS),
    howto: nullable(oneOf("skipped", "auto")),
    rtt: nullable(MS),
    /** Opponent Shots the seed check rejected, and ones that passed only thanks to the latency slack. */
    invalid: COUNT,
    near: COUNT,
  }),
  practice: shape({
    ...CLIENT,
    ...TYPING,
    rid: ID,
    active: SECONDS,
    calib: nullable(PACE),
    start: nullable(num(0, 3600)),
    level: nullable(num(0, 3600)),
  }),
  p2p: shape({
    ...CLIENT,
    mid: ID,
    kind: KIND,
    role: oneOf("host", "guest"),
    ok: bool,
    fail: nullable(oneOf("iceFailed", "timeout", "signalingLost", "peerLeft", "graceExpired", "aborted")),
    pair: nullable(oneOf("host", "srflx", "prflx", "relay")),
    ms: nullable(MS),
    gather: nullable(MS),
    ice: list(MAX_ICE_STATES, shape({ s: text(/^[a-z]{1,16}$/), ms: MS })),
    /** Candidates offered, by type: what each side could reach (no srflx = STUN blocked). */
    cand: shape({ lh: COUNT, ls: COUNT, lr: COUNT, rh: COUNT, rs: COUNT, rr: COUNT }),
  }),
  mm: shape({ ...CLIENT, kind: KIND, lang: LANG, wait: MS, why: oneOf("left", "error", "resting") }),
  rematch: shape({ ...CLIENT, mid: ID, kind: KIND, n: int(0, 999), out: oneOf("played", "declined", "expired", "left", "closed") }),
};

export type RecordType = keyof typeof RECORDS;

const COUNTRY = /^[A-Z]{2}$/;

export class Metrics {
  constructor(private readonly deps: MetricsDeps) {}

  /** Checks a record (throws `invalid`), logs it, and keeps Match and Practice records in the history. */
  async report(pid: string, record: unknown, country?: string): Promise<void> {
    const type = (record as Rec | null)?.t;
    if (typeof type !== "string" || !Object.hasOwn(RECORDS, type)) throw invalid();
    const clean = RECORDS[type as RecordType](record) as Rec;

    const { sampleRate, random = Math.random } = this.deps;
    if (sampleRate <= 0 || random() >= sampleRate) return;

    const cc = country && COUNTRY.test(country) ? country : null;
    const line: Rec = { t: type, v: SCHEMA_VERSION, pid, cc, ...clean };
    // Logs Insights sums numbers, not booleans; and a missing field fails every comparison, so no null `fail`.
    for (const [key, value] of Object.entries(line)) if (typeof value === "boolean") line[key] = value ? 1 : 0;
    if (type === "p2p" && line.fail === null) line.fail = "none";
    // Sampled lines stand for 1/rate records each; queries sum `w` instead of counting.
    if (sampleRate < 1) line.w = Math.round(1000 / sampleRate) / 1000;

    if (type === "match" || type === "practice") {
      const id = type === "match" ? `${clean.mid}#${clean.n}` : clean.rid;
      const details = await this.deps.store.put({ ...line, pid, sk: `${clean.at}#${id}` });
      if (details === "duplicate") return; // a retry: already logged once
      if (details === "throttled") line.dropped = true; // over the free capacity: log only
    }
    // The attack list stays in the history only: it would make the log line several KB.
    if (type === "match") delete line.attacks;
    this.deps.log(line);
  }
}

/** Tests and local dev: keeps the history in memory. */
export class MemoryDetailsStore implements DetailsStore {
  readonly items = new Map<string, Rec>();
  async put(item: { pid: string; sk: string } & Rec): Promise<DetailsResult> {
    const key = `${item.pid}|${item.sk}`;
    if (this.items.has(key)) return "duplicate";
    this.items.set(key, item);
    return "ok";
  }
}
