import type { FlowNetwork, Language, NetworkEvent } from '../flow/types';
import type { MatchTransport } from '../match/types';
import { ApiError, type MatchApi, type MatchView } from './api';
import { TransportError, type ConnectionRecord } from './errors';
import type { PeerLink } from './PeerLink';
import { connectPeer, type ConnectOptions, type PeerConnection, type PendingConnection, type SignalMessage } from './rtc';
import { realTimers, type Timers } from './timers';

/** The opponent, once the channel is open: what the Match needs to run. */
export interface OnlineMatch {
  matchId: string;
  role: 'host' | 'guest';
  /** The host's language: both players use its word list. */
  lang: Language;
  seeds: { mine: number; theirs: number };
  transport: MatchTransport;
  /** Half the measured round trip, in seconds (for checking the opponent's Shot times). */
  oneWaySeconds(): number;
}

export interface OnlineNetworkOptions {
  api: MatchApi;
  /** This build's word list + picker version for a language; the guest must match the host's. */
  listVersion: (lang: Language) => string;
  inviteLink: (matchId: string) => string;
  timers?: Timers;
  connect?: (options: ConnectOptions) => PendingConnection;
  /** Passed through to `connectPeer` (tests use it for fake WebRTC). */
  connectOptions?: Partial<ConnectOptions>;
  /** Every connection attempt, success or failure, for the metrics. */
  onRecord?: (record: ConnectionRecord) => void;
  log?: (entry: Record<string, unknown>) => void;
  /** Poll cadence while waiting for an opponent, and during the handshake. */
  pollWaitingMs?: number;
  pollHandshakeMs?: number;
  /** How far ahead the host sets the common start, so the guest hears about it in time. */
  startDelayMs?: number;
  busyRetryMs?: number;
}

/** Polls in a row that may fail before the line to the backend counts as lost. */
const MAX_POLL_FAILURES = 3;
/** The host waits this long at most for a first clock measurement before setting the start. */
const MAX_SYNC_WAIT_MS = 3000;

/** One search, from joining until leaving. Everything async checks `cancelled` before acting. */
interface Attempt {
  cancelled: boolean;
  matchId?: string;
  role?: 'host' | 'guest';
  view?: MatchView;
  handshaking: boolean;
  pollFailures: number;
  stops: Array<() => void>;
  pending?: PendingConnection;
  connection?: PeerConnection;
  match?: OnlineMatch;
  /** Offer / answer handed to the handshake already (polls repeat them). */
  delivered: Set<string>;
  signalHandlers: Set<(message: SignalMessage) => void>;
  lostHandlers: Set<() => void>;
}

/**
 * The real network behind the screen flow: matchmaking and signaling over the backend (`/api`), then a
 * direct WebRTC channel to the opponent. It polls the backend (~2 s while waiting, ~0.7 s during the
 * handshake), connects (the host offers after pairing, the guest answers), and once the channel is open
 * the host sets a common start so both Countdowns begin together (`connected` fires at that moment on each
 * side). Match events, Rematch messages and liveness then travel over the channel only.
 */
export class OnlineNetwork implements FlowNetwork {
  private readonly api: MatchApi;
  private readonly timers: Timers;
  private readonly connect: (options: ConnectOptions) => PendingConnection;
  private readonly options: Required<Pick<OnlineNetworkOptions, 'pollWaitingMs' | 'pollHandshakeMs' | 'startDelayMs' | 'busyRetryMs'>>;
  private attempt: Attempt | null = null;
  private handlers = new Set<(event: NetworkEvent) => void>();

  constructor(private readonly config: OnlineNetworkOptions) {
    this.api = config.api;
    this.timers = config.timers ?? realTimers;
    this.connect = config.connect ?? connectPeer;
    this.options = {
      pollWaitingMs: config.pollWaitingMs ?? 2000,
      pollHandshakeMs: config.pollHandshakeMs ?? 700,
      startDelayMs: config.startDelayMs ?? 500,
      busyRetryMs: config.busyRetryMs ?? 1000,
    };
  }

  /** The connected opponent (null before the channel opens or after leaving). */
  currentMatch(): OnlineMatch | null {
    return this.attempt?.match ?? null;
  }

  joinQueue(language: Language) {
    this.begin(async (a) => {
      const view = await this.retryIfBusy(() => this.api.queue(language, this.config.listVersion(language)));
      this.enter(a, view);
    });
  }

  createPrivate(language: Language) {
    this.begin(async (a) => {
      const view = await this.api.createMatch(language, this.config.listVersion(language));
      if (a.cancelled) return;
      this.emit({ type: 'inviteCreated', link: this.config.inviteLink(view.matchId) });
      this.enter(a, view);
    });
  }

  joinPrivate(code: string) {
    this.begin(async (a) => {
      let view: MatchView;
      try {
        view = await this.api.join(code);
      } catch (error) {
        if (error instanceof ApiError && ['full', 'expired', 'own'].includes(error.code)) {
          if (!a.cancelled) this.emit({ type: 'inviteInvalid', reason: error.code === 'full' ? 'full' : 'expired' });
          return;
        }
        throw error;
      }
      this.enter(a, view);
    });
  }

  sendRematch(message: 'propose' | 'accept' | 'decline') {
    this.attempt?.connection?.link.send({ type: 'rematch', message });
  }

  /** Leaves whatever is going on, quietly: the backend is told, an open channel says goodbye. */
  leave() {
    const a = this.attempt;
    if (!a) return;
    this.attempt = null;
    a.cancelled = true;
    a.stops.forEach((stop) => stop());
    a.pending?.abort();
    if (a.connection) a.connection.close();
    else if (a.matchId) this.api.leave(a.matchId).catch(() => {});
  }

  onEvent(cb: (event: NetworkEvent) => void) {
    this.handlers.add(cb);
    return () => void this.handlers.delete(cb);
  }

  // ---- internals ----

  private emit(event: NetworkEvent) {
    this.handlers.forEach((h) => h(event));
  }

  private log(entry: Record<string, unknown>) {
    this.config.log?.(entry);
  }

  private begin(run: (a: Attempt) => Promise<void>) {
    this.leave();
    const a: Attempt = {
      cancelled: false,
      handshaking: false,
      pollFailures: 0,
      stops: [],
      delivered: new Set(),
      signalHandlers: new Set(),
      lostHandlers: new Set(),
    };
    this.attempt = a;
    run(a).catch((error: unknown) => {
      if (a.cancelled) return;
      this.log({ event: 'online_error', error: error instanceof ApiError ? error.code : String(error) });
      this.emit({ type: 'connectFailed' });
    });
  }

  private async retryIfBusy<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'busy')) throw error;
      await new Promise<void>((resolve) => this.timers.after(this.options.busyRetryMs, resolve));
      return call();
    }
  }

  /** We have a match id: wait for the pairing, or start the handshake if it already happened. */
  private enter(a: Attempt, view: MatchView) {
    if (a.cancelled) return;
    a.matchId = view.matchId;
    a.role = view.role;
    a.view = view;
    if (view.role === 'guest' && view.listVersion !== this.config.listVersion(view.lang)) {
      // Different words or picker: every honest Shot would fail the other side's check.
      this.log({ event: 'version_mismatch', theirs: view.listVersion, mine: this.config.listVersion(view.lang) });
      this.emit({ type: 'connectFailed' });
      return;
    }
    if (view.status === 'paired') this.handshake(a);
    this.schedulePoll(a);
  }

  private schedulePoll(a: Attempt) {
    if (a.cancelled || a.connection) return;
    const delay = a.handshaking ? this.options.pollHandshakeMs : this.options.pollWaitingMs;
    a.stops.push(this.timers.after(delay, () => void this.poll(a)));
  }

  private async poll(a: Attempt) {
    if (a.cancelled || a.connection) return;
    let view: MatchView;
    try {
      view = await this.api.poll(a.matchId!);
      a.pollFailures = 0;
    } catch (error) {
      if (a.cancelled) return;
      if (error instanceof ApiError && (error.status === 404 || error.status === 403)) return this.gone(a);
      if (++a.pollFailures >= MAX_POLL_FAILURES) {
        if (a.handshaking) a.lostHandlers.forEach((h) => h());
        else this.emit({ type: 'connectFailed' });
        return;
      }
      return this.schedulePoll(a);
    }
    if (a.cancelled) return;
    a.view = view;
    if (!a.handshaking && view.status === 'paired') this.handshake(a);
    if (a.handshaking) {
      if (view.opponentGone) return this.gone(a);
      const sdp = a.role === 'guest' ? view.offer : view.answer;
      if (sdp && !a.delivered.has(sdp)) {
        a.delivered.add(sdp);
        const message: SignalMessage = { type: a.role === 'guest' ? 'offer' : 'answer', sdp };
        a.signalHandlers.forEach((h) => h(message));
      }
    }
    this.schedulePoll(a);
  }

  /**
   * The match vanished from the backend. After pairing that's the opponent leaving. Before we even saw the
   * pairing (they joined and left between two polls), a Public search just goes back in the queue; a Private
   * match's link is dead, so that's an error.
   */
  private gone(a: Attempt) {
    if (!a.handshaking && a.view?.kind === 'public') return this.joinQueue(a.view.lang);
    this.emit(a.handshaking ? { type: 'opponentLeft' } : { type: 'connectFailed' });
    this.leave();
  }

  private handshake(a: Attempt) {
    a.handshaking = true;
    this.emit({ type: 'matched' });
    a.pending = this.connect({
      ...this.config.connectOptions,
      role: a.role!,
      timers: this.timers,
      signaling: {
        send: (message) => this.api.signal(a.matchId!, message.type, message.sdp),
        onMessage: (cb) => {
          a.signalHandlers.add(cb);
          return () => void a.signalHandlers.delete(cb);
        },
        onLost: (cb) => {
          a.lostHandlers.add(cb);
          return () => void a.lostHandlers.delete(cb);
        },
      },
    });
    a.pending.done.then(
      (connection) => this.opened(a, connection),
      (error: unknown) => {
        if (error instanceof TransportError) {
          if (error.kind === 'aborted') return;
          this.config.onRecord?.(error.record);
        }
        if (a.cancelled) return;
        this.log({ event: 'connect_failed', reason: error instanceof TransportError ? error.kind : String(error) });
        this.emit({ type: 'connectFailed' });
      },
    );
  }

  private opened(a: Attempt, connection: PeerConnection) {
    this.config.onRecord?.(connection.record);
    if (a.cancelled) return connection.close();
    a.connection = connection;
    const { link } = connection;
    const view = a.view!;
    a.match = {
      matchId: a.matchId!,
      role: a.role!,
      lang: view.lang,
      seeds: view.seeds!,
      transport: link.toMatchTransport(),
      oneWaySeconds: () => (link.rttMs ?? 0) / 2000,
    };
    this.api.connected(a.matchId!).catch(() => {});

    link.onEvent((event) => {
      if (a.cancelled) return;
      if (event.type === 'signalLost') this.emit({ type: 'opponentDisconnected' });
      else if (event.type === 'signalBack') this.emit({ type: 'opponentReconnected' });
      else this.emit({ type: 'opponentLeft' });
    });
    link.onMessage((message) => {
      if (!a.cancelled && message.type === 'rematch') this.emit({ type: 'rematch', message: message.message });
    });
    this.startTogether(a, link);
  }

  /** Both sides fire `connected` at the same real moment: the host picks it, the guest converts it. */
  private startTogether(a: Attempt, link: PeerLink) {
    let started = false;
    const startAt = (localTime: number) => {
      if (started) return;
      started = true;
      a.stops.push(
        this.timers.after(Math.max(0, localTime - this.timers.now()), () => {
          if (!a.cancelled) this.emit({ type: 'connected' });
        }),
      );
    };
    if (a.role === 'guest') {
      link.onMessage((message) => {
        if (message.type === 'startAt') startAt(link.toLocalTime(message.at));
      });
      return;
    }
    const since = this.timers.now();
    const waitForClock = this.timers.every(50, () => {
      if (link.rttMs === null && this.timers.now() - since < MAX_SYNC_WAIT_MS) return;
      waitForClock();
      startAt(link.startIn(this.options.startDelayMs));
    });
    a.stops.push(waitForClock);
  }
}
