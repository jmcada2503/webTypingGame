import type { Language } from '../flow/types';
import type { OnlineCounts } from '../screens/content';
import { realTimers, type Timers } from './timers';

/** The backend counts heartbeats per 60 s window and reports the last complete one. */
const WINDOW_MS = 60_000;
/** A tab beats at a fixed offset inside every window, away from the edges so clock skew can't move it. */
const OFFSET_MIN_MS = 2000;
const OFFSET_SPAN_MS = 53_000;
/** The count is CloudFront-cached for 30 s: refreshing more often gains nothing. */
const REFRESH_MS = 30_000;

/** The count plus the share of tabs asked to heartbeat (1 = all; less once many are online). */
export type OnlineReport = OnlineCounts & { sample?: number };

export interface PresenceOptions {
  language: () => Language;
  beat: (lang: Language) => Promise<void>;
  /** The count; CloudFront-cached for 30 s, so asking often costs nothing. */
  fetchOnline: () => Promise<OnlineReport>;
  timers?: Timers;
  /** Wall clock (windows are wall-clock aligned, like the backend's). */
  now?: () => number;
  /** Fixes this tab's offset inside the window. */
  random?: () => number;
  /** The coin flipped each window when only a share of tabs should heartbeat. */
  coin?: () => number;
}

/**
 * Keeps this tab counted as online and keeps the latest count for the screens. One heartbeat per window, which
 * also keeps the `api` Lambda warm; once more than ~50 tabs are online the backend asks only a share of them
 * (`sample`), and each tab flips a coin per window. Failures (servers resting, offline) are ignored: the last
 * count stays.
 */
export function startPresence(options: PresenceOptions) {
  const { language, beat, fetchOnline, timers = realTimers, now = () => Date.now(), random = Math.random, coin = Math.random } = options;
  const offset = OFFSET_MIN_MS + Math.floor(random() * OFFSET_SPAN_MS);
  let latest: OnlineCounts | null = null;
  let sample = 1;
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
      if (coin() < sample) beat(language()).catch(() => {});
      scheduleBeat();
    });
  }

  const refresh = () =>
    fetchOnline().then(
      ({ en, es, total, sample: share }) => {
        if (stopped) return;
        latest = { en, es, total };
        sample = typeof share === 'number' && share > 0 && share <= 1 ? share : 1;
      },
      () => {},
    );

  scheduleBeat();
  void refresh();
  const stopRefresh = timers.every(REFRESH_MS, () => void refresh());

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
