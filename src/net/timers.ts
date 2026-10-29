/** Time as the transport sees it, so tests can run it by hand. `now` is milliseconds on a monotonic clock. */
export interface Timers {
  now(): number;
  /** Runs `fn` every `ms`; returns a function that stops it. */
  every(ms: number, fn: () => void): () => void;
  /** Runs `fn` once after `ms`; returns a function that cancels it. */
  after(ms: number, fn: () => void): () => void;
}

export const realTimers: Timers = {
  now: () => performance.now(),
  every(ms, fn) {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  },
  after(ms, fn) {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
};
