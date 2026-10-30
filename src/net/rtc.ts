import { TransportError, type ConnectionRecord, type TransportErrorKind } from './errors';
import { DEFAULT_LINK_CONFIG, PeerLink, type LinkConfig } from './PeerLink';
import { realTimers, type Timers } from './timers';

// ---- the slice of WebRTC we use, so tests can stand in for the browser ----

export interface RtcChannel {
  readyState: 'connecting' | 'open' | 'closing' | 'closed';
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export type RtcStatsReport = { id: string; type: string; [key: string]: unknown };

export interface RtcConnection {
  readonly iceConnectionState: string;
  readonly iceGatheringState: string;
  readonly localDescription: RTCSessionDescriptionInit | null;
  oniceconnectionstatechange: (() => void) | null;
  onicegatheringstatechange: (() => void) | null;
  ondatachannel: ((event: { channel: RtcChannel }) => void) | null;
  createDataChannel(label: string, init: { ordered: boolean }): RtcChannel;
  setLocalDescription(description?: RTCSessionDescriptionInit): Promise<void>;
  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void>;
  getStats(): Promise<{ forEach(cb: (report: RtcStatsReport) => void): void }>;
  close(): void;
}

export const STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
];

const browserConnection = (): RtcConnection =>
  new RTCPeerConnection({ iceServers: STUN_SERVERS }) as unknown as RtcConnection;

/** A line of text messages to the opponent. */
export interface Wire {
  send(text: string): void;
  onMessage(cb: (text: string) => void): () => void;
  onClose(cb: () => void): () => void;
  close(): void;
}

export function wireOfChannel(channel: RtcChannel): Wire {
  const messages = new Set<(text: string) => void>();
  const closes = new Set<() => void>();
  channel.onmessage = (event) => {
    if (typeof event.data === 'string') messages.forEach((cb) => cb(event.data as string));
  };
  channel.onclose = () => closes.forEach((cb) => cb());
  return {
    send(text) {
      if (channel.readyState === 'open') channel.send(text);
    },
    onMessage(cb) {
      messages.add(cb);
      return () => void messages.delete(cb);
    },
    onClose(cb) {
      closes.add(cb);
      return () => void closes.delete(cb);
    },
    close: () => channel.close(),
  };
}

// ---- signaling: the backend relays the offer and the answer ----

export type SignalMessage = { type: 'offer' | 'answer'; sdp: string };

/** The line to the opponent through the backend. The real one polls the Lambda (the signaling ticket). */
export interface Signaling {
  send(message: SignalMessage): void | Promise<void>;
  onMessage(cb: (message: SignalMessage) => void): () => void;
  /** Called when the line is gone for good (network down, match gone). */
  onLost(cb: () => void): () => void;
}

// ---- connecting ----

export interface ConnectOptions {
  /** The host (the waiter) makes the offer; the guest answers. */
  role: 'host' | 'guest';
  signaling: Signaling;
  timers?: Timers;
  createConnection?: () => RtcConnection;
  /** Give up on connecting after this long. */
  timeoutMs?: number;
  /** Stop waiting for candidate gathering after this long and send what we have (no trickle). */
  iceGatherMs?: number;
  link?: LinkConfig;
  userAgent?: string;
}

/** An open connection to the opponent. */
export interface PeerConnection {
  link: PeerLink;
  record: ConnectionRecord;
  /** Leave: tell the opponent and release the connection. */
  close(): void;
}

export interface PendingConnection {
  /** Resolves when the channel is open; rejects with a `TransportError` (carrying the record). */
  done: Promise<PeerConnection>;
  /** Give up now (the player left). Rejects `done` with `aborted`. */
  abort(): void;
}

const PAIR_RANK = { host: 0, srflx: 1, prflx: 1, relay: 2 } as const;

export function connectPeer(options: ConnectOptions): PendingConnection {
  const {
    role,
    signaling,
    timers = realTimers,
    createConnection = browserConnection,
    timeoutMs = 10_000,
    iceGatherMs = 1500,
    link: linkConfig = DEFAULT_LINK_CONFIG,
    userAgent = typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent,
  } = options;

  const started = timers.now();
  const since = () => Math.round(timers.now() - started);
  const record: ConnectionRecord = {
    role,
    iceTimeline: [],
    gatherMs: null,
    pairType: null,
    connectMs: null,
    failure: null,
    browser: browserName(userAgent),
    candidates: { local: emptyCount(), remote: emptyCount() },
  };

  const pc = createConnection();
  const stops: Array<() => void> = [];
  let settled = false;
  let fail!: (kind: TransportErrorKind) => void;

  const done = new Promise<PeerConnection>((resolve, reject) => {
    const settle = () => {
      settled = true;
      stops.forEach((stop) => stop());
    };

    fail = (kind) => {
      if (settled) return;
      settle();
      record.failure = kind;
      pc.close();
      reject(new TransportError(kind, record));
    };

    const succeed = async (channel: RtcChannel) => {
      if (settled) return;
      settle();
      record.connectMs = since();
      record.pairType = await selectedPairType(pc).catch(() => null);
      const link = new PeerLink(wireOfChannel(channel), timers, linkConfig);
      link.onEvent((event) => {
        if (event.type === 'closed') pc.close();
      });
      resolve({
        record,
        link,
        close() {
          link.close();
          pc.close();
        },
      });
    };

    const bind = (channel: RtcChannel) => {
      channel.onopen = () => void succeed(channel);
      if (channel.readyState === 'open') void succeed(channel);
    };

    stops.push(timers.after(timeoutMs, () => fail('timeout')));
    stops.push(signaling.onLost(() => fail('signalingLost')));

    pc.oniceconnectionstatechange = () => {
      record.iceTimeline.push({ atMs: since(), state: pc.iceConnectionState });
      if (pc.iceConnectionState === 'failed') fail('iceFailed');
    };
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') record.gatherMs ??= since();
    };

    /** Resolves when candidates are gathered, or after the cap: we send whatever we have. */
    const gathered = () =>
      new Promise<void>((done) => {
        if (pc.iceGatheringState === 'complete') return done();
        const stop = timers.after(iceGatherMs, finish);
        const poll = timers.every(50, () => pc.iceGatheringState === 'complete' && finish());
        function finish() {
          stop();
          poll();
          done();
        }
        stops.push(stop, poll);
      });

    const run = async () => {
      if (role === 'host') {
        stops.push(
          signaling.onMessage((message) => {
            if (message.type === 'answer') record.candidates.remote = countCandidates(message.sdp);
            if (message.type === 'answer') pc.setRemoteDescription({ type: 'answer', sdp: message.sdp }).catch(() => fail('iceFailed'));
          }),
        );
        bind(pc.createDataChannel('game', { ordered: true }));
        await pc.setLocalDescription();
        await gathered();
        record.candidates.local = countCandidates(pc.localDescription?.sdp);
        if (!settled) await signaling.send({ type: 'offer', sdp: pc.localDescription!.sdp! });
      } else {
        pc.ondatachannel = (event) => bind(event.channel);
        stops.push(
          signaling.onMessage((message) => {
            if (message.type !== 'offer') return;
            record.candidates.remote = countCandidates(message.sdp);
            void (async () => {
              await pc.setRemoteDescription({ type: 'offer', sdp: message.sdp });
              await pc.setLocalDescription();
              await gathered();
              record.candidates.local = countCandidates(pc.localDescription?.sdp);
              if (!settled) await signaling.send({ type: 'answer', sdp: pc.localDescription!.sdp! });
            })().catch(() => fail('iceFailed'));
          }),
        );
      }
    };
    run().catch(() => fail('signalingLost'));
  });

  return { done, abort: () => fail('aborted') };
}

const emptyCount = () => ({ host: 0, srflx: 0, relay: 0 });

/** Candidates in a description, by type (no trickle: they are all in it). No srflx = STUN didn't answer. */
export function countCandidates(sdp: string | undefined) {
  const count = emptyCount();
  for (const match of (sdp ?? '').matchAll(/^a=candidate:.* typ (host|srflx|prflx|relay)/gm)) {
    const type = match[1] === 'prflx' ? 'srflx' : (match[1] as keyof typeof count);
    count[type]++;
  }
  return count;
}

/** The kind of network path in use. Relay beats srflx beats host; null if the browser won't say. */
async function selectedPairType(pc: RtcConnection): Promise<ConnectionRecord['pairType']> {
  const reports = new Map<string, RtcStatsReport>();
  (await pc.getStats()).forEach((report) => reports.set(report.id, report));

  let pair: RtcStatsReport | undefined;
  for (const report of reports.values()) {
    if (report.type === 'transport' && typeof report.selectedCandidatePairId === 'string') {
      pair = reports.get(report.selectedCandidatePairId);
    }
  }
  // Firefox and older Safari: no transport report, look for the nominated pair.
  pair ??= [...reports.values()].find(
    (r) => r.type === 'candidate-pair' && (r.selected === true || (r.nominated === true && r.state === 'succeeded')),
  );
  if (!pair) return null;

  const kinds = [pair.localCandidateId, pair.remoteCandidateId]
    .map((id) => (typeof id === 'string' ? reports.get(id)?.candidateType : undefined))
    .filter((kind): kind is keyof typeof PAIR_RANK => typeof kind === 'string' && kind in PAIR_RANK);
  if (kinds.length === 0) return null;
  return kinds.reduce((best, kind) => (PAIR_RANK[kind] > PAIR_RANK[best] ? kind : best));
}

export function browserName(userAgent: string): string {
  // Order matters: Edge and Opera also say Chrome, Chrome also says Safari.
  for (const [token, name] of [
    ['Edg', 'Edge'],
    ['OPR', 'Opera'],
    ['FxiOS', 'Firefox'],
    ['Firefox', 'Firefox'],
    ['CriOS', 'Chrome'],
    ['Chrome', 'Chrome'],
  ] as const) {
    const match = new RegExp(`${token}/(\\d+)`).exec(userAgent);
    if (match) return `${name} ${match[1]}`;
  }
  const safari = /Version\/(\d+).*Safari/.exec(userAgent);
  return safari ? `Safari ${safari[1]}` : 'unknown';
}
