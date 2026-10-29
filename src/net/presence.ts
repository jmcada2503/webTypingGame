import type { Language } from '../flow/types';
import type { OnlineCounts } from '../screens/content';
import { realTimers, type Timers } from './timers';

/** The backend counts heartbeats per 30 s window and reports the last complete one. */
const WINDOW_MS = 30_000;
/** A tab beats at a fixed offset inside every window, away from the edges so clock skew can't move it. */
const OFFSET_MIN_MS = 2000;
const OFFSET_SPAN_MS = 25_000;

export interface PresenceOptions {
  language: () => Language;
  beat: (lang: Language) => Promise<void>;
  /** The count; CloudFront-cached for 30 s, so asking often costs nothing. */
  fetchOnline: () => Promise<OnlineCounts>;
  timers?: Timers;
  /** Wall clock (windows are wall-clock aligned, like the backend's). */
  now?: () => number;
  random?: () => number;
}

/**
 * Keeps this tab counted as online (one heartbeat per window, which also keeps the `api` Lambda warm) and
 * keeps the latest count for the screens. Failures (servers resting, offline) are ignored: the last count stays.
 */
export function startPresence(options: PresenceOptions) {
  const { language, beat, fetchOnline, timers = realTimers, now = () => Date.now(), random = Math.random } = options;
  const offset = OFFSET_MIN_MS + Math.floor(random() * OFFSET_SPAN_MS);
  let latest: OnlineCounts | null = null;
  let stopped = false;
  let lastWindow = -1;
  let cancelBeat = () => {};

  function scheduleBeat() {
    const t = now();
    const window = Math.floor(t / WINDOW_MS);
    const next = window * WINDOW_MS + offset > t && window !== lastWindow ? window : window + 1;
    cancelBeat = timers.after(next * WINDOW_MS + offset - t, () => {
      if (stopped) return;
      lastWindow = next;
      beat(language()).catch(() => {});
      scheduleBeat();
    });
  }

  const refresh = () =>
    fetchOnline().then(
      (counts) => void (stopped || (latest = counts)),
      () => {},
    );

  scheduleBeat();
  void refresh();
  const stopRefresh = timers.every(WINDOW_MS, () => void refresh());

  return {
    /** Null until the first answer. */
    counts: () => latest,
    stop() {
      stopped = true;
      cancelBeat();
      stopRefresh();
    },
  };
}
