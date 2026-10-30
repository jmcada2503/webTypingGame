import { describe, expect, it } from 'vitest';
import type { Language, NetworkEvent } from '../flow/types';
import { ApiError, type MatchApi, type MatchView } from './api';
import type { ConnectionRecord } from './errors';
import { OnlineNetwork } from './OnlineNetwork';
import { FakeNetwork, FakeRtc, FakeTimers, type FakeRtcOptions } from './testing';

type Item = {
  id: string;
  lang: Language;
  kind: 'public' | 'private';
  host: string;
  guest?: string;
  listVersion: string;
  seeds?: { host: number; guest: number };
  offer?: string;
  answer?: string;
  connected: Set<string>;
};

/** Just enough of the backend's behaviour (the real one is tested in infra/). */
class FakeServer {
  queue = new Map<Language, string>();
  matches = new Map<string, Item>();
  private n = 0;
  /** Makes the next N calls of this player fail like a network error. */
  failing = new Map<string, number>();
  busy = 0;

  api(pid: string): MatchApi {
    const guard = async () => {
      const left = this.failing.get(pid) ?? 0;
      if (left > 0) {
        this.failing.set(pid, left - 1);
        throw new TypeError('Failed to fetch');
      }
    };
    const get = (id: string) => {
      const m = this.matches.get(id);
      if (!m) throw new ApiError(404, 'gone');
      if (m.host !== pid && m.guest !== pid) throw new ApiError(403, 'forbidden');
      return m;
    };
    return {
      queue: async (lang, listVersion) => {
        await guard();
        if (this.busy > 0) {
          this.busy--;
          throw new ApiError(503, 'busy');
        }
        const waiting = this.queue.get(lang);
        const m = waiting ? this.matches.get(waiting) : undefined;
        if (m && m.host !== pid) {
          this.queue.delete(lang);
          m.guest = pid;
          m.seeds = { host: 11, guest: 22 };
          return this.view(m, pid);
        }
        if (m) return this.view(m, pid);
        const made = this.create(pid, lang, 'public', listVersion);
        this.queue.set(lang, made.id);
        return this.view(made, pid);
      },
      createMatch: async (lang, listVersion) => {
        await guard();
        return this.view(this.create(pid, lang, 'private', listVersion), pid);
      },
      join: async (id) => {
        await guard();
        const m = this.matches.get(id);
        if (!m) throw new ApiError(404, 'expired');
        if (m.guest && m.guest !== pid) throw new ApiError(409, 'full');
        m.guest = pid;
        m.seeds = { host: 33, guest: 44 };
        return this.view(m, pid);
      },
      poll: async (id) => {
        await guard();
        return this.view(get(id), pid);
      },
      signal: async (id, type, sdp) => {
        await guard();
        get(id)[type] = sdp;
      },
      connected: async (id) => {
        await guard();
        const m = get(id);
        m.connected.add(pid);
        return this.view(m, pid);
      },
      leave: async (id) => {
        await guard();
        const m = this.matches.get(id);
        if (!m) return;
        if (this.queue.get(m.lang) === id) this.queue.delete(m.lang);
        this.matches.delete(id);
      },
    };
  }

  private create(host: string, lang: Language, kind: 'public' | 'private', listVersion: string): Item {
    const m: Item = { id: `m${++this.n}`, lang, kind, host, listVersion, connected: new Set() };
    this.matches.set(m.id, m);
    return m;
  }

  private view(m: Item, pid: string): MatchView {
    const role = m.host === pid ? 'host' : 'guest';
    return {
      matchId: m.id,
      role,
      status: m.guest ? 'paired' : 'waiting',
      kind: m.kind,
      lang: m.lang,
      listVersion: m.listVersion,
      seeds: m.seeds && (role === 'host' ? { mine: m.seeds.host, theirs: m.seeds.guest } : { mine: m.seeds.guest, theirs: m.seeds.host }),
      offer: role === 'guest' ? m.offer : undefined,
      answer: role === 'host' ? m.answer : undefined,
      opponentGone: false,
      bothConnected: m.connected.size === 2,
    };
  }
}

function setup(rtcOptions: FakeRtcOptions = {}, versions: { a?: string; b?: string } = {}) {
  const timers = new FakeTimers();
  const net = new FakeNetwork(timers);
  const rtc = new FakeRtc(net, rtcOptions);
  const server = new FakeServer();
  const records: ConnectionRecord[] = [];
  const player = (pid: string, version: string) => {
    const network = new OnlineNetwork({
      api: server.api(pid),
      timers,
      listVersion: () => version,
      inviteLink: (id) => `https://game.test/#/m/${id}`,
      connectOptions: { createConnection: rtc.createConnection, userAgent: 'Chrome/130' },
      onRecord: (r) => records.push(r),
    });
    const events: Array<NetworkEvent & { at: number }> = [];
    network.onEvent((e) => events.push({ ...e, at: timers.now() }));
    return { network, events, types: () => events.map((e) => e.type) };
  };
  return { timers, net, rtc, server, records, a: player('player-a', versions.a ?? 'v1'), b: player('player-b', versions.b ?? 'v1') };
}

describe('a Public match', () => {
  it('pairs, connects over P2P and starts both Countdowns at the same moment', async () => {
    const { timers, a, b } = setup();
    a.network.joinQueue('en');
    await timers.advanceAsync(100);
    b.network.joinQueue('en');
    await timers.advanceAsync(8000);

    expect(a.types()).toEqual(['matched', 'connected']);
    expect(b.types()).toEqual(['matched', 'connected']);
    const startA = a.events.find((e) => e.type === 'connected')!.at;
    const startB = b.events.find((e) => e.type === 'connected')!.at;
    expect(Math.abs(startA - startB)).toBeLessThanOrEqual(30);
  });

  it('hands the Match its seeds (mine and theirs, swapped), language and a working transport', async () => {
    const { timers, a, b } = setup();
    a.network.joinQueue('es');
    await timers.advanceAsync(100);
    b.network.joinQueue('es');
    await timers.advanceAsync(8000);

    const ma = a.network.currentMatch()!;
    const mb = b.network.currentMatch()!;
    expect(ma).toMatchObject({ role: 'host', lang: 'es', seeds: { mine: 11, theirs: 22 } });
    expect(mb).toMatchObject({ role: 'guest', lang: 'es', seeds: { mine: 22, theirs: 11 } });
    const got: unknown[] = [];
    mb.transport.onEvent((e) => got.push(e));
    ma.transport.send({ type: 'peace' });
    await timers.advanceAsync(200);
    expect(got).toEqual([{ type: 'peace' }]);
    expect(ma.oneWaySeconds()).toBeGreaterThan(0);
  });

  it('records each connection for the metrics', async () => {
    const { timers, a, b, records } = setup({ pairType: 'srflx' });
    a.network.joinQueue('en');
    await timers.advanceAsync(100);
    b.network.joinQueue('en');
    await timers.advanceAsync(8000);
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.role).sort()).toEqual(['guest', 'host']);
    expect(records.every((r) => r.pairType === 'srflx' && r.failure === null)).toBe(true);
  });

  it('tells the server it is connected', async () => {
    const { timers, server, a, b } = setup();
    a.network.joinQueue('en');
    await timers.advanceAsync(100);
    b.network.joinQueue('en');
    await timers.advanceAsync(8000);
    expect([...server.matches.values()][0].connected.size).toBe(2);
  });

  it('retries once when the server is busy, then gives up with connectFailed', async () => {
    const { timers, server, a } = setup();
    server.busy = 1;
    a.network.joinQueue('en');
    await timers.advanceAsync(3000);
    expect(a.types()).toEqual([]);
    expect(server.queue.get('en')).toBeDefined();

    a.network.leave();
    server.busy = 2;
    a.network.joinQueue('en');
    await timers.advanceAsync(3000);
    expect(a.types()).toEqual(['connectFailed']);
  });
});

describe('Private matches', () => {
  it('creates the Invite link, and a friend joins with it', async () => {
    const { timers, a, b } = setup();
    a.network.createPrivate('en');
    await timers.advanceAsync(100);
    const invite = a.events.find((e) => e.type === 'inviteCreated') as { link: string } | undefined;
    expect(invite?.link).toBe('https://game.test/#/m/m1');

    b.network.joinPrivate('m1');
    await timers.advanceAsync(8000);
    expect(a.types()).toEqual(['inviteCreated', 'matched', 'connected']);
    expect(b.types()).toEqual(['matched', 'connected']);
  });

  it('a full or expired link says so', async () => {
    const { timers, server, a, b } = setup();
    b.network.joinPrivate('nope');
    await timers.advanceAsync(100);
    expect(b.events.at(-1)).toMatchObject({ type: 'inviteInvalid', reason: 'expired' });

    a.network.createPrivate('en');
    await timers.advanceAsync(100);
    server.matches.get('m1')!.guest = 'someone-else';
    b.network.joinPrivate('m1');
    await timers.advanceAsync(100);
    expect(b.events.at(-1)).toMatchObject({ type: 'inviteInvalid', reason: 'full' });
  });
});

describe('when it goes wrong', () => {
  it('different word lists or picker versions: the guest refuses (honest Shots would fail)', async () => {
    const { timers, a, b } = setup({}, { a: 'v1', b: 'v2' });
    a.network.joinQueue('en');
    await timers.advanceAsync(100);
    b.network.joinQueue('en');
    await timers.advanceAsync(500);
    expect(b.types()).toEqual(['connectFailed']);
  });

  it('no network path between the players: connectFailed on both, recorded', async () => {
    const { timers, a, b, records } = setup({ outcome: 'failed' });
    a.network.joinQueue('en');
    await timers.advanceAsync(100);
    b.network.joinQueue('en');
    await timers.advanceAsync(8000);
    expect(a.types()).toEqual(['matched', 'connectFailed']);
    expect(b.types()).toEqual(['matched', 'connectFailed']);
    expect(records.map((r) => r.failure)).toEqual(['iceFailed', 'iceFailed']);
  });

  it('the opponent leaves during the handshake: opponentLeft', async () => {
    const { timers, a, b } = setup({ outcome: 'never' });
    a.network.joinQueue('en');
    await timers.advanceAsync(100);
    b.network.joinQueue('en');
    await timers.advanceAsync(2500); // the host has seen the pairing
    b.network.leave();
    await timers.advanceAsync(3000);
    expect(a.types()).toEqual(['matched', 'opponentLeft']);
  });

  it('an opponent who joins and leaves before the host notices: the host just keeps searching', async () => {
    const { timers, server, a } = setup({ outcome: 'never' });
    const b2 = new OnlineNetwork({ api: server.api('player-b'), timers, listVersion: () => 'v1', inviteLink: (id) => id });
    a.network.joinQueue('en');
    await timers.advanceAsync(100);
    b2.joinQueue('en');
    await timers.advanceAsync(100);
    b2.leave();
    await timers.advanceAsync(5000);
    expect(a.types()).toEqual([]);
    expect(server.queue.get('en')).toBeDefined();
    expect(server.matches.get(server.queue.get('en')!)!.host).toBe('player-a');
  });

  it('the server goes away while waiting: connectFailed after 3 failed polls', async () => {
    const { timers, server, a } = setup();
    a.network.joinQueue('en');
    await timers.advanceAsync(100);
    server.failing.set('player-a', 3);
    await timers.advanceAsync(7000);
    expect(a.types()).toEqual(['connectFailed']);
  });

  it('one failed poll is not enough to give up', async () => {
    const { timers, server, a, b } = setup();
    a.network.joinQueue('en');
    await timers.advanceAsync(100);
    server.failing.set('player-a', 1);
    await timers.advanceAsync(2500);
    b.network.joinQueue('en');
    await timers.advanceAsync(8000);
    expect(a.types()).toEqual(['matched', 'connected']);
  });
});

describe('after connecting', () => {
  async function connected(options: FakeRtcOptions = {}) {
    const t = setup(options);
    t.a.network.joinQueue('en');
    await t.timers.advanceAsync(100);
    t.b.network.joinQueue('en');
    await t.timers.advanceAsync(8000);
    return t;
  }

  const reconnected = (events: Array<NetworkEvent & { at: number }>) => events.filter((e) => e.type === 'opponentReconnected') as Array<{ type: 'opponentReconnected'; resumeIn: number; at: number }>;

  it('a lost signal is opponentDisconnected, and opponentReconnected when it returns', async () => {
    const { timers, net, a } = await connected();
    net.cut();
    await timers.advanceAsync(5000);
    net.heal();
    await timers.advanceAsync(3000);
    expect(a.types().slice(2)).toEqual(['opponentDisconnected', 'opponentReconnected']);
  });

  it('when the signal returns both sides get one opponentReconnected, and the resume ends at the same moment', async () => {
    const { timers, net, a, b } = await connected();
    net.cut();
    await timers.advanceAsync(5000);
    net.heal();
    await timers.advanceAsync(4000);

    const [ra] = reconnected(a.events);
    const [rb] = reconnected(b.events);
    expect(reconnected(a.events)).toHaveLength(1);
    expect(reconnected(b.events)).toHaveLength(1);
    expect(Math.max(ra.resumeIn, rb.resumeIn)).toBeCloseTo(5, 5); // the host's full countdown
    expect(Math.min(ra.resumeIn, rb.resumeIn)).toBeLessThan(5); // the guest joins a little later, same end
    expect(ra.at + ra.resumeIn * 1000).toBeCloseTo(rb.at + rb.resumeIn * 1000, -1);
  });

  it('the guest stays away until the host says the Match resumes', async () => {
    const { timers, net, a, b } = await connected();
    net.cut();
    await timers.advanceAsync(5000);
    net.heal();
    await timers.advanceAsync(1);
    // Nothing has crossed yet: neither side has been told the signal is back.
    expect([...reconnected(a.events), ...reconnected(b.events)]).toEqual([]);
    await timers.advanceAsync(4000);
    expect(reconnected(a.events)).toHaveLength(1);
    expect(reconnected(b.events)).toHaveLength(1);
  });

  it('silence past the grace (the 4 s to notice plus the 10 s of the Match) is opponentLeft', async () => {
    const { timers, net, a } = await connected();
    net.cut();
    await timers.advanceAsync(13_000);
    expect(a.types().slice(2)).toEqual(['opponentDisconnected']);
    await timers.advanceAsync(3000);
    expect(a.types().slice(2)).toEqual(['opponentDisconnected', 'opponentLeft']);
  });

  it('the opponent leaving is opponentLeft', async () => {
    const { timers, a, b } = await connected();
    b.network.leave();
    await timers.advanceAsync(500);
    expect(a.types().at(-1)).toBe('opponentLeft');
    expect(a.network.currentMatch()).not.toBeNull(); // still readable until we leave too
  });

  it('carries Rematch messages over the open channel', async () => {
    const { timers, a, b } = await connected();
    a.network.sendRematch('propose');
    await timers.advanceAsync(200);
    b.network.sendRematch('accept');
    await timers.advanceAsync(200);
    expect(b.events.at(-1)).toMatchObject({ type: 'rematch', message: 'propose' });
    expect(a.events.at(-1)).toMatchObject({ type: 'rematch', message: 'accept' });
  });

  it('leaving drops the match and stays quiet afterwards', async () => {
    const { timers, net, a } = await connected();
    a.network.leave();
    expect(a.network.currentMatch()).toBeNull();
    const before = a.events.length;
    net.cut();
    await timers.advanceAsync(15_000);
    expect(a.events.length).toBe(before);
  });
});

describe('leaving while waiting', () => {
  it('cancels the search on the server', async () => {
    const { timers, server, a, b } = setup();
    a.network.joinQueue('en');
    await timers.advanceAsync(100);
    a.network.leave();
    await timers.advanceAsync(100);
    expect(server.queue.get('en')).toBeUndefined();
    expect(server.matches.size).toBe(0);
    b.network.joinQueue('en');
    await timers.advanceAsync(100);
    expect(b.network.currentMatch()).toBeNull();
  });

  it('a new search replaces the old one', async () => {
    const { timers, server, a } = setup();
    a.network.createPrivate('en');
    await timers.advanceAsync(100);
    a.network.joinQueue('en');
    await timers.advanceAsync(100);
    expect([...server.matches.values()].map((m) => m.kind)).toEqual(['public']);
  });
});

describe('the check before joining', () => {
  it('runs before every search and join, and a false stops it quietly', async () => {
    const timers = new FakeTimers();
    const server = new FakeServer();
    const asked: Array<string | undefined> = [];
    let allow = false;
    const network = new OnlineNetwork({
      api: server.api('player-a'),
      timers,
      listVersion: () => 'v1',
      inviteLink: (id) => id,
      beforeJoin: async (code) => (asked.push(code), allow),
    });
    const events: string[] = [];
    network.onEvent((e) => events.push(e.type));

    network.joinQueue('en');
    network.createPrivate('en');
    network.joinPrivate('m9');
    await timers.advanceAsync(100);
    expect(asked).toEqual([undefined, undefined, 'm9']);
    expect(server.matches.size).toBe(0);
    expect(events).toEqual([]);

    allow = true;
    network.joinQueue('en');
    await timers.advanceAsync(100);
    expect(server.queue.get('en')).toBeDefined();
  });
});
