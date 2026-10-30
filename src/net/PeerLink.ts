import type { MatchTransport, NetEvent } from '../match/types';
import type { TransportErrorKind } from './errors';
import type { Wire } from './rtc';
import type { Timers } from './timers';

/** Everything that crosses between the two players: Match events plus the control messages. */
export type WireMessage =
  | NetEvent
  /** The Countdown ends at `at` on the sender's clock; convert with `toLocalTime`. */
  | { type: 'startAt'; at: number }
  /** After a signal loss: the Match resumes at `at` on the sender's clock (the host decides, both sides end together). */
  | { type: 'resumeAt'; at: number }
  | { type: 'rematch'; message: 'propose' | 'accept' | 'decline' | 'cancel' };

const MATCH_EVENTS = new Set<string>(['shot', 'defended', 'hit', 'presence', 'peace']);

/** What happens to the connection after it opened. */
export type LinkEvent =
  /** Nothing heard for a while: the opponent may be gone. The Match counts these. */
  | { type: 'signalLost' }
  | { type: 'signalBack' }
  /** Over: the opponent left, or the grace ran out. */
  | { type: 'closed'; error: Extract<TransportErrorKind, 'peerLeft' | 'graceExpired'> };

export interface LinkConfig {
  heartbeatMs: number;
  /** Silence (or an unacked event) this long ends the connection: the time to notice plus the Match's 10 s grace. */
  graceMs: number;
  /** Silence this long counts as a signal loss. */
  signalLostMs: number;
  /** How often silence is checked. */
  watchMs: number;
}

export const DEFAULT_LINK_CONFIG: LinkConfig = { heartbeatMs: 2000, graceMs: 14_000, signalLostMs: 4000, watchMs: 500 };

type Frame =
  | { k: 'm'; id: string; n: number; b: WireMessage }
  | { k: 'hb'; ack: number }
  | { k: 'ping'; id: number; t0: number }
  | { k: 'pong'; id: number; t0: number; t1: number }
  | { k: 'bye' };

const SYNC_PINGS = 5;
const SYNC_SPACING_MS = 150;
const RESYNC_MS = 30_000;

/**
 * One reliable line to the opponent over a Wire (the WebRTC DataChannel). The channel is already reliable and
 * ordered; this adds what the game needs on top:
 * - every event has a sequence number and an id; duplicates are ignored,
 * - a heartbeat every 2 s carries a cumulative ack, and anything unacked is sent again with it,
 * - silence or an unacked event past the grace ends the connection; shorter silence is a signal loss,
 * - a clock offset to the opponent (ping-pong, Cristian) so both Countdowns end together.
 */
export class PeerLink {
  private readonly session = Math.random().toString(36).slice(2, 8);
  private nextSeq = 1;
  private unacked: { n: number; text: string; sentAt: number }[] = [];
  /** Highest event of theirs delivered, in order. */
  private delivered = 0;
  private remoteSession: string | null = null;
  private lastHeard: number;
  private lost = false;
  private closed = false;
  private messageHandlers = new Set<(message: WireMessage) => void>();
  private eventHandlers = new Set<(event: LinkEvent) => void>();
  private stops: Array<() => void> = [];
  private pingId = 0;
  private bestRtt: number | null = null;
  private offset: number | null = null;

  constructor(
    private readonly wire: Wire,
    private readonly timers: Timers,
    private readonly config: LinkConfig = DEFAULT_LINK_CONFIG,
  ) {
    this.lastHeard = timers.now();
    this.stops.push(wire.onMessage((text) => this.receive(text)));
    this.stops.push(wire.onClose(() => this.fail('peerLeft')));
    this.stops.push(timers.every(config.heartbeatMs, () => this.heartbeat()));
    this.stops.push(timers.every(config.watchMs, () => this.watch()));
    this.stops.push(timers.every(RESYNC_MS, () => this.sync()));
    this.sync();
  }

  /** Shortest round trip seen so far, in ms (null until the first pong). */
  get rttMs() {
    return this.bestRtt;
  }

  /** Their clock minus ours, in ms (null until the first pong). */
  get clockOffsetMs() {
    return this.offset;
  }

  /** A moment on the opponent's clock, expressed on ours. Assumes equal clocks until measured. */
  toLocalTime(theirTime: number) {
    return theirTime - (this.offset ?? 0);
  }

  /** Host side of the Countdown: it ends `delayMs` from now. Tells the guest, returns the moment on our clock. */
  startIn(delayMs: number) {
    return this.announce('startAt', delayMs);
  }

  /** Host side after a signal loss: the Match resumes `delayMs` from now. Tells the guest, returns the moment on our clock. */
  resumeIn(delayMs: number) {
    return this.announce('resumeAt', delayMs);
  }

  private announce(type: 'startAt' | 'resumeAt', delayMs: number) {
    const at = this.timers.now() + delayMs;
    this.send({ type, at });
    return at;
  }

  send(message: WireMessage) {
    if (this.closed) return;
    const n = this.nextSeq++;
    const text = JSON.stringify({ k: 'm', id: `${this.session}:${n}`, n, b: message } satisfies Frame);
    this.unacked.push({ n, text, sentAt: this.timers.now() });
    this.wire.send(text);
  }

  onMessage(cb: (message: WireMessage) => void) {
    this.messageHandlers.add(cb);
    return () => void this.messageHandlers.delete(cb);
  }

  onEvent(cb: (event: LinkEvent) => void) {
    this.eventHandlers.add(cb);
    return () => void this.eventHandlers.delete(cb);
  }

  /** The line the Match engine uses: only Match events pass. */
  toMatchTransport(): MatchTransport {
    return {
      send: (event) => this.send(event),
      onEvent: (cb) =>
        this.onMessage((message) => {
          if (MATCH_EVENTS.has(message.type)) cb(message as NetEvent);
        }),
    };
  }

  /** Leaves on purpose: tells the opponent, then stops quietly. */
  close() {
    if (this.closed) return;
    this.sendFrame({ k: 'bye' });
    this.shutdown();
  }

  // ---- internals ----

  private sendFrame(frame: Frame) {
    this.wire.send(JSON.stringify(frame));
  }

  private heartbeat() {
    this.sendFrame({ k: 'hb', ack: this.delivered });
    // Anything still unacked may have been lost: send it again (the other side ignores copies).
    for (const item of this.unacked) this.wire.send(item.text);
  }

  private watch() {
    const now = this.timers.now();
    const silence = now - this.lastHeard;
    const oldest = this.unacked[0];
    if (silence >= this.config.graceMs || (oldest && now - oldest.sentAt >= this.config.graceMs)) {
      this.fail('graceExpired');
    } else if (silence >= this.config.signalLostMs && !this.lost) {
      this.lost = true;
      this.emit({ type: 'signalLost' });
    }
  }

  private sync() {
    for (let i = 0; i < SYNC_PINGS; i++) {
      this.stops.push(this.timers.after(i * SYNC_SPACING_MS, () => this.ping()));
    }
  }

  private ping() {
    if (!this.closed) this.sendFrame({ k: 'ping', id: this.pingId++, t0: this.timers.now() });
  }

  private receive(text: string) {
    if (this.closed) return;
    let frame: Frame;
    try {
      frame = JSON.parse(text) as Frame;
    } catch {
      return;
    }
    if (!frame || typeof frame !== 'object') return;
    const known = ['m', 'hb', 'ping', 'pong', 'bye'];
    if (!known.includes(frame.k)) return;

    this.lastHeard = this.timers.now();
    if (this.lost) {
      this.lost = false;
      this.emit({ type: 'signalBack' });
    }

    switch (frame.k) {
      case 'm': {
        const session = frame.id.split(':')[0];
        this.remoteSession ??= session;
        if (session !== this.remoteSession) return;
        // Only the next one in order: older is a copy, newer waits for the resend of the gap.
        if (frame.n !== this.delivered + 1) return;
        this.delivered = frame.n;
        this.messageHandlers.forEach((h) => h(frame.b));
        return;
      }
      case 'hb':
        this.unacked = this.unacked.filter((item) => item.n > frame.ack);
        return;
      case 'ping':
        this.sendFrame({ k: 'pong', id: frame.id, t0: frame.t0, t1: this.timers.now() });
        return;
      case 'pong': {
        const t2 = this.timers.now();
        const rtt = t2 - frame.t0;
        if (this.bestRtt === null || rtt < this.bestRtt) {
          this.bestRtt = rtt;
          this.offset = frame.t1 - (frame.t0 + t2) / 2;
        }
        return;
      }
      case 'bye':
        this.fail('peerLeft');
    }
  }

  private fail(error: 'peerLeft' | 'graceExpired') {
    if (this.closed) return;
    this.shutdown();
    this.emit({ type: 'closed', error });
  }

  private shutdown() {
    this.closed = true;
    this.stops.forEach((stop) => stop());
    this.stops = [];
    this.wire.close();
  }

  private emit(event: LinkEvent) {
    this.eventHandlers.forEach((h) => h(event));
  }
}
