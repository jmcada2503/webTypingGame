// Test doubles for the P2P transport: a clock you advance by hand, a pair of data channels with
// latency / loss / cuts, and a pair of fake peer connections that go through the real handshake.
import type { RtcChannel, RtcConnection, RtcStatsReport, Signaling, SignalMessage } from './rtc';
import type { Timers } from './timers';

export class FakeTimers implements Timers {
  private time = 0;
  private nextId = 1;
  private tasks = new Map<number, { at: number; every: number | null; fn: () => void }>();

  now() {
    return this.time;
  }

  every(ms: number, fn: () => void) {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.time + ms, every: ms, fn });
    return () => void this.tasks.delete(id);
  }

  after(ms: number, fn: () => void) {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.time + ms, every: null, fn });
    return () => void this.tasks.delete(id);
  }

  /** Like `advance`, in small steps with promises settling in between (for the async handshake). */
  async advanceAsync(ms: number, stepMs = 25) {
    for (let left = ms; left > 0; left -= stepMs) {
      this.advance(Math.min(stepMs, left));
      for (let i = 0; i < 10; i++) await Promise.resolve();
    }
  }

  /** Moves time forward, running every task that comes due on the way, in time order. */
  advance(ms: number) {
    const end = this.time + ms;
    for (;;) {
      let nextId = -1;
      let next = Infinity;
      for (const [id, task] of this.tasks) {
        if (task.at < next) {
          next = task.at;
          nextId = id;
        }
      }
      if (nextId < 0 || next > end) break;
      const task = this.tasks.get(nextId)!;
      this.time = next;
      if (task.every !== null) task.at += task.every;
      else this.tasks.delete(nextId);
      task.fn();
    }
    this.time = end;
  }
}

/** The same clock, read `offsetMs` ahead: one player's clock running fast. */
export function shifted(timers: Timers, offsetMs: number): Timers {
  return {
    now: () => timers.now() + offsetMs,
    every: (ms, fn) => timers.every(ms, fn),
    after: (ms, fn) => timers.after(ms, fn),
  };
}

/** Both ends of a data channel, with a network between them that you can make slow, lossy or dead. */
export class FakeNetwork {
  latencyMs = 20;
  /** Called for every message; return true to lose it. */
  loseIf: ((data: string, from: 'a' | 'b') => boolean) | null = null;
  private cutOff = false;

  constructor(readonly timers: FakeTimers) {}

  /** Everything sent from now on is lost, in both directions. */
  cut() {
    this.cutOff = true;
  }

  heal() {
    this.cutOff = false;
  }

  /** Whether a message sent now gets through. */
  passes(data: string, from: 'a' | 'b') {
    return !this.cutOff && !this.loseIf?.(data, from);
  }

  /** Two open channels wired to each other. */
  channelPair(): [FakeChannel, FakeChannel] {
    const a = new FakeChannel(this, 'a');
    const b = new FakeChannel(this, 'b');
    a.peer = b;
    b.peer = a;
    a.readyState = b.readyState = 'open';
    return [a, b];
  }
}

export class FakeChannel implements RtcChannel {
  readyState: RtcChannel['readyState'] = 'connecting';
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  peer!: FakeChannel;
  /** Everything this end sent, parsed, for assertions. */
  readonly sent: unknown[] = [];

  constructor(
    private readonly net: FakeNetwork,
    private readonly side: 'a' | 'b',
  ) {}

  send(data: string) {
    this.sent.push(JSON.parse(data));
    if (this.readyState !== 'open' || !this.net.passes(data, this.side)) return;
    this.net.timers.after(this.net.latencyMs, () => {
      if (this.peer.readyState === 'open') this.peer.onmessage?.({ data });
    });
  }

  close() {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    this.net.timers.after(this.net.latencyMs, () => {
      if (this.peer.readyState !== 'closed') {
        this.peer.readyState = 'closed';
        this.peer.onclose?.();
      }
    });
  }

  open() {
    this.readyState = 'open';
    this.onopen?.();
  }
}

export interface FakeRtcOptions {
  /** Time ICE takes to gather candidates; Infinity = never completes. */
  gatherMs?: number;
  /** Time from both descriptions set to the channel opening. */
  connectMs?: number;
  /** The ICE connection state the pair ends in. */
  outcome?: 'connected' | 'failed' | 'never';
  pairType?: 'host' | 'srflx' | 'relay';
  /** `getStats()` never answers (a stuck browser). */
  statsHang?: boolean;
}

/** Hands out the two ends of one fake WebRTC connection; the end that creates the data channel is the host's. */
export class FakeRtc {
  private ends: FakeRtcEnd[] = [];
  readonly options: Required<FakeRtcOptions>;
  /** The channel pair once the connection is up, for sending and cutting from tests. */
  channels: [FakeChannel, FakeChannel] | null = null;

  constructor(
    readonly net: FakeNetwork,
    options: FakeRtcOptions = {},
  ) {
    this.options = { gatherMs: 300, connectMs: 400, outcome: 'connected', pairType: 'srflx', statsHang: false, ...options };
  }

  readonly createConnection = (): RtcConnection => {
    const end = new FakeRtcEnd(this, this.ends.length);
    this.ends.push(end);
    return end;
  };

  /** Called when an end has both descriptions: start connecting once both sides do. */
  ready() {
    if (this.ends.length < 2 || !this.ends.every((e) => e.local && e.remote)) return;
    const { net, options } = this;
    const host = this.ends.find((e) => e.channel)!;
    const guest = this.ends.find((e) => e !== host)!;
    net.timers.after(options.connectMs, () => {
      if (options.outcome === 'never') return;
      for (const end of this.ends) end.setIce(options.outcome === 'failed' ? 'failed' : 'connected');
      if (options.outcome === 'failed') return;
      // The host's own channel gets the guest's end wired to it.
      const a = host.channel!;
      const b = new FakeChannel(net, 'b');
      a.peer = b;
      b.peer = a;
      this.channels = [a, b];
      guest.ondatachannel?.({ channel: b });
      a.open();
      b.open();
    });
  }
}

class FakeRtcEnd implements RtcConnection {
  iceConnectionState = 'new';
  iceGatheringState = 'new';
  localDescription: RTCSessionDescriptionInit | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  onicegatheringstatechange: (() => void) | null = null;
  ondatachannel: ((event: { channel: RtcChannel }) => void) | null = null;
  local = false;
  remote = false;
  channel: FakeChannel | null = null;
  closed = false;

  constructor(
    private readonly rtc: FakeRtc,
    private readonly index: number,
  ) {}

  createDataChannel(_label: string, init: { ordered: boolean }) {
    if (!init.ordered) throw new Error('the game channel must be ordered');
    const pending = new FakeChannel(this.rtc.net, 'a');
    this.channel = pending;
    return pending;
  }

  async setLocalDescription() {
    this.local = true;
    this.localDescription = { type: this.channel ? 'offer' : 'answer', sdp: `sdp-${this.index}` };
    this.iceGatheringState = 'gathering';
    this.onicegatheringstatechange?.();
    const { gatherMs } = this.rtc.options;
    if (Number.isFinite(gatherMs)) {
      this.rtc.net.timers.after(gatherMs, () => {
        this.iceGatheringState = 'complete';
        this.onicegatheringstatechange?.();
      });
    }
    this.rtc.ready();
  }

  async setRemoteDescription() {
    this.remote = true;
    this.setIce('checking');
    this.rtc.ready();
  }

  async getStats() {
    // Like a browser: a closed connection has no stats.
    if (this.closed) throw new Error('InvalidStateError: the connection is closed');
    const { pairType, statsHang } = this.rtc.options;
    if (statsHang) return new Promise<never>(() => {});
    const ice = this.iceConnectionState;
    const state = ice === 'connected' ? 'succeeded' : ice === 'failed' ? 'failed' : 'in-progress';
    const reports: RtcStatsReport[] = [
      { id: 't', type: 'transport', selectedCandidatePairId: 'p' },
      {
        id: 'p',
        type: 'candidate-pair',
        localCandidateId: 'l',
        remoteCandidateId: 'r',
        state,
        nominated: state === 'succeeded',
        requestsSent: 5,
        responsesReceived: state === 'succeeded' ? 5 : 0,
        requestsReceived: 2,
        responsesSent: 2,
      },
      { id: 'l', type: 'local-candidate', candidateType: pairType, address: '203.0.113.1', port: 50000 + this.index, protocol: 'udp' },
      { id: 'r', type: 'remote-candidate', candidateType: 'host', address: 'abc.local', port: 60000, protocol: 'udp' },
    ];
    return { forEach: (cb: (report: RtcStatsReport) => void) => reports.forEach(cb) };
  }

  close() {
    this.closed = true;
  }

  setIce(state: string) {
    this.iceConnectionState = state;
    this.oniceconnectionstatechange?.();
  }
}

/** A signaling line between two players (the real one polls the backend). `lose()` kills one end's line. */
export function signalingPair(timers: FakeTimers, delayMs = 50) {
  const make = () => {
    const handlers = new Set<(msg: SignalMessage) => void>();
    const lost = new Set<() => void>();
    return { handlers, lost };
  };
  const a = make();
  const b = make();
  const line = (mine: ReturnType<typeof make>, theirs: ReturnType<typeof make>): Signaling & { lose(): void } => ({
    send(msg) {
      timers.after(delayMs, () => theirs.handlers.forEach((h) => h(msg)));
    },
    onMessage(cb) {
      mine.handlers.add(cb);
      return () => void mine.handlers.delete(cb);
    },
    onLost(cb) {
      mine.lost.add(cb);
      return () => void mine.lost.delete(cb);
    },
    lose() {
      mine.lost.forEach((h) => h());
    },
  });
  return { host: line(a, b), guest: line(b, a) };
}
