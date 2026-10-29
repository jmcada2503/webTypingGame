import type { FlowNetwork, Language, NetworkEvent } from './types';

/**
 * An in-memory stand-in for matchmaking plus the P2P channel, for tests and for building screens before
 * the real network exists. One backend, many endpoints (one per player); everything happens synchronously.
 * Pairing sends both players `matched` and then `connected` straight away.
 */
export class FakeBackend {
  private queues = new Map<Language, FakeEndpoint[]>();
  /** Private matches by code: the host, and whether a guest already joined. */
  private invites = new Map<string, { host: FakeEndpoint; full: boolean }>();
  private nextCode = 1;

  /** A new player's line to the backend. */
  connect() {
    return new FakeEndpoint(this);
  }

  /** Test helper: this player's connection drops (the opponent is told). */
  drop(endpoint: FakeEndpoint) {
    endpoint.peer?.deliver({ type: 'opponentDisconnected' });
  }

  /** Test helper: a dropped connection comes back. */
  reconnect(endpoint: FakeEndpoint) {
    endpoint.peer?.deliver({ type: 'opponentReconnected' });
  }

  // ---- used by the endpoints ----

  joinQueue(endpoint: FakeEndpoint, language: Language) {
    const queue = this.queues.get(language) ?? [];
    const waiting = queue.shift();
    this.queues.set(language, queue);
    if (waiting) this.pair(waiting, endpoint);
    else queue.push(endpoint);
  }

  createInvite(endpoint: FakeEndpoint) {
    const code = `K7Q2-${String(this.nextCode++).padStart(4, '0')}`;
    this.invites.set(code, { host: endpoint, full: false });
    endpoint.deliver({ type: 'inviteCreated', link: `https://typingame.example/#/m/${code}` });
  }

  joinInvite(endpoint: FakeEndpoint, code: string) {
    const invite = this.invites.get(code);
    if (!invite) return endpoint.deliver({ type: 'inviteInvalid', reason: 'expired' });
    if (invite.full) return endpoint.deliver({ type: 'inviteInvalid', reason: 'full' });
    invite.full = true;
    this.pair(invite.host, endpoint);
  }

  leave(endpoint: FakeEndpoint) {
    for (const queue of this.queues.values()) {
      const i = queue.indexOf(endpoint);
      if (i >= 0) queue.splice(i, 1);
    }
    for (const [code, invite] of this.invites) if (invite.host === endpoint) this.invites.delete(code);
    const peer = endpoint.peer;
    if (peer) {
      endpoint.peer = null;
      peer.peer = null;
      peer.deliver({ type: 'opponentLeft' });
    }
  }

  private pair(a: FakeEndpoint, b: FakeEndpoint) {
    a.peer = b;
    b.peer = a;
    a.deliver({ type: 'matched' });
    b.deliver({ type: 'matched' });
    a.deliver({ type: 'connected' });
    b.deliver({ type: 'connected' });
  }
}

/** One player's side of the fake network. */
export class FakeEndpoint implements FlowNetwork {
  /** The opponent, once paired. */
  peer: FakeEndpoint | null = null;
  private handlers = new Set<(event: NetworkEvent) => void>();

  constructor(private readonly backend: FakeBackend) {}

  joinQueue(language: Language) {
    this.backend.joinQueue(this, language);
  }

  createPrivate() {
    this.backend.createInvite(this);
  }

  joinPrivate(code: string) {
    this.backend.joinInvite(this, code);
  }

  leave() {
    this.backend.leave(this);
  }

  sendRematch(message: 'propose' | 'accept' | 'decline') {
    this.peer?.deliver({ type: 'rematch', message });
  }

  onEvent(cb: (event: NetworkEvent) => void) {
    this.handlers.add(cb);
    return () => void this.handlers.delete(cb);
  }

  deliver(event: NetworkEvent) {
    this.handlers.forEach((h) => h(event));
  }
}
