import { describe, expect, it } from 'vitest';
import type { NetEvent } from '../match/types';
import { PeerLink, type LinkEvent, type WireMessage } from './PeerLink';
import { FakeNetwork, FakeTimers, shifted } from './testing';
import { wireOfChannel } from './rtc';

function setup(configure?: (net: FakeNetwork) => void) {
  const timers = new FakeTimers();
  const net = new FakeNetwork(timers);
  configure?.(net);
  const [chA, chB] = net.channelPair();
  const a = new PeerLink(wireOfChannel(chA), timers);
  const b = new PeerLink(wireOfChannel(chB), timers);
  const gotA: WireMessage[] = [];
  const gotB: WireMessage[] = [];
  const eventsA: LinkEvent[] = [];
  const eventsB: LinkEvent[] = [];
  a.onMessage((m) => gotA.push(m));
  b.onMessage((m) => gotB.push(m));
  a.onEvent((e) => eventsA.push(e));
  b.onEvent((e) => eventsB.push(e));
  return { timers, net, a, b, chA, chB, gotA, gotB, eventsA, eventsB };
}

const shot = (i: number): NetEvent => ({ type: 'shot', i, t: i, word: `w${i}` });

describe('delivery', () => {
  it('delivers events in order', () => {
    const { timers, a, gotB } = setup();
    a.send(shot(0));
    a.send(shot(1));
    a.send({ type: 'defended', i: 0 });
    timers.advance(100);
    expect(gotB).toEqual([shot(0), shot(1), { type: 'defended', i: 0 }]);
  });

  it('numbers every event with a sequence number and an id', () => {
    const { a, chA } = setup();
    a.send(shot(0));
    a.send(shot(1));
    const frames = chA.sent.filter((f) => (f as { k: string }).k === 'm') as { n: number; id: string }[];
    expect(frames.map((f) => f.n)).toEqual([1, 2]);
    expect(new Set(frames.map((f) => f.id)).size).toBe(2);
  });

  it('ignores a duplicate of an event it already delivered', () => {
    const { timers, a, chA, chB, gotB } = setup();
    a.send(shot(0));
    timers.advance(100);
    const duplicate = chA.sent.find((f) => (f as { k: string }).k === 'm');
    chB.onmessage?.({ data: JSON.stringify(duplicate) });
    chB.onmessage?.({ data: JSON.stringify(duplicate) });
    expect(gotB).toEqual([shot(0)]);
  });

  it('survives garbage on the wire', () => {
    const { chB, gotB, eventsB } = setup();
    chB.onmessage?.({ data: 'not json' });
    chB.onmessage?.({ data: '{"k":"zzz"}' });
    expect(gotB).toEqual([]);
    expect(eventsB).toEqual([]);
  });

  it('exposes only Match events to the Match', () => {
    const { timers, a, b } = setup();
    const matchEvents: NetEvent[] = [];
    b.toMatchTransport().onEvent((e) => matchEvents.push(e));
    a.send(shot(0));
    a.send({ type: 'rematch', message: 'propose' });
    a.send({ type: 'startAt', at: 5000 });
    a.toMatchTransport().send({ type: 'peace' });
    timers.advance(100);
    expect(matchEvents).toEqual([shot(0), { type: 'peace' }]);
  });
});

describe('reliability: acks and resends', () => {
  it('carries a cumulative ack in the 2 s heartbeat', () => {
    const { timers, a, b, chB } = setup();
    a.send(shot(0));
    a.send(shot(1));
    timers.advance(2100);
    const heartbeats = chB.sent.filter((f) => (f as { k: string }).k === 'hb') as { ack: number }[];
    expect(heartbeats[0].ack).toBe(2);
    expect(b).toBeDefined();
  });

  it('resends a lost event until it is acked, delivering it exactly once', () => {
    let dropped = 0;
    const { timers, a, gotB } = setup((net) => {
      net.loseIf = (data, from) => {
        const lostFirstCopy = from === 'a' && data.includes('"k":"m"') && dropped++ < 1;
        return lostFirstCopy;
      };
    });
    a.send(shot(0));
    timers.advance(100);
    expect(gotB).toEqual([]);
    timers.advance(2100);
    expect(gotB).toEqual([shot(0)]);
    timers.advance(10_000);
    expect(gotB).toEqual([shot(0)]);
  });

  it('keeps events in order when an early one is lost and later ones arrive first', () => {
    let first = true;
    const { timers, a, gotB } = setup((net) => {
      net.loseIf = (data) => {
        if (first && data.includes('"n":1,')) {
          first = false;
          return true;
        }
        return false;
      };
    });
    a.send(shot(0));
    a.send(shot(1));
    a.send(shot(2));
    timers.advance(100);
    expect(gotB).toEqual([]);
    timers.advance(2100);
    expect(gotB).toEqual([shot(0), shot(1), shot(2)]);
  });

  it('copes with a slow network', () => {
    const { timers, a, gotB, eventsA, eventsB } = setup((net) => (net.latencyMs = 1500));
    a.send(shot(0));
    timers.advance(20_000);
    expect(gotB).toEqual([shot(0)]);
    expect(eventsA).toEqual([]);
    expect(eventsB).toEqual([]);
  });
});

describe('heartbeat, signal and grace', () => {
  it('stays quiet while the connection is healthy', () => {
    const { timers, eventsA, eventsB } = setup();
    timers.advance(60_000);
    expect(eventsA).toEqual([]);
    expect(eventsB).toEqual([]);
  });

  it('reports signal lost after 4 s of silence, and signal back when it returns', () => {
    const { timers, net, eventsA } = setup();
    timers.advance(1000);
    net.cut();
    timers.advance(3000);
    expect(eventsA).toEqual([]);
    timers.advance(2000);
    expect(eventsA).toEqual([{ type: 'signalLost' }]);
    net.heal();
    timers.advance(2500);
    expect(eventsA).toEqual([{ type: 'signalLost' }, { type: 'signalBack' }]);
  });

  it('gives up with graceExpired after 10 s of silence', () => {
    const { timers, net, a, eventsA } = setup();
    timers.advance(1000);
    net.cut();
    timers.advance(10_500);
    expect(eventsA.at(-1)).toEqual({ type: 'closed', error: 'graceExpired' });
    expect(() => a.send(shot(0))).not.toThrow();
  });

  it('does not give up if the signal comes back inside the grace', () => {
    const { timers, net, eventsA } = setup();
    net.cut();
    timers.advance(7000);
    net.heal();
    timers.advance(4000);
    expect(eventsA.map((e) => e.type)).toEqual(['signalLost', 'signalBack']);
  });

  it('counts an event unacked past the grace as a disconnect, even if their heartbeats still reach us', () => {
    const { timers, a, eventsA } = setup((net) => {
      net.loseIf = (_data, from) => from === 'a';
    });
    a.send(shot(0));
    timers.advance(11_000);
    expect(eventsA.at(-1)).toEqual({ type: 'closed', error: 'graceExpired' });
  });

  it('tells the other side when it closes cleanly: peerLeft', () => {
    const { timers, a, eventsA, eventsB } = setup();
    a.close();
    timers.advance(100);
    expect(eventsB).toEqual([{ type: 'closed', error: 'peerLeft' }]);
    expect(eventsA).toEqual([]);
  });

  it('treats a channel that closes underneath it as peerLeft', () => {
    const { timers, chA, eventsB } = setup();
    chA.close();
    timers.advance(100);
    expect(eventsB).toEqual([{ type: 'closed', error: 'peerLeft' }]);
  });

  it('stops all timers once closed', () => {
    const { timers, net, a, eventsA } = setup();
    a.close();
    net.cut();
    timers.advance(60_000);
    expect(eventsA).toEqual([]);
  });
});

describe('clock offset and startAt', () => {
  it('measures the other clock (Cristian) and the round trip', () => {
    const timers = new FakeTimers();
    const net = new FakeNetwork(timers);
    net.latencyMs = 40;
    const [chA, chB] = net.channelPair();
    const a = new PeerLink(wireOfChannel(chA), timers);
    // B's clock runs 5000 ms ahead of A's.
    const b = new PeerLink(wireOfChannel(chB), shifted(timers, 5000));
    timers.advance(2000);
    expect(a.rttMs).toBe(80);
    expect(a.clockOffsetMs).toBeCloseTo(5000, 0);
    expect(b.clockOffsetMs).toBeCloseTo(-5000, 0);
  });

  it('keeps the sample with the shortest round trip', () => {
    const timers = new FakeTimers();
    const net = new FakeNetwork(timers);
    let n = 0;
    net.latencyMs = 40;
    const [chA, chB] = net.channelPair();
    const a = new PeerLink(wireOfChannel(chA), timers);
    new PeerLink(wireOfChannel(chB), timers);
    // The first pings are slow, then the network settles.
    const originalSend = chA.send.bind(chA);
    chA.send = (data: string) => {
      if (data.includes('"ping"') && n++ < 2) net.latencyMs = 300;
      else net.latencyMs = 40;
      originalSend(data);
    };
    timers.advance(3000);
    expect(a.rttMs).toBe(80);
  });

  it('starts both Countdowns at the same moment', () => {
    const timers = new FakeTimers();
    const net = new FakeNetwork(timers);
    net.latencyMs = 60;
    const [chA, chB] = net.channelPair();
    const host = new PeerLink(wireOfChannel(chA), timers);
    const guest = new PeerLink(wireOfChannel(chB), shifted(timers, 7777));
    timers.advance(2000);

    let guestStart = 0;
    guest.onMessage((m) => {
      if (m.type === 'startAt') guestStart = guest.toLocalTime(m.at);
    });
    const hostStart = host.startIn(500);
    timers.advance(1000);

    // Same real moment, each in their own clock.
    expect(hostStart).toBe(timers.now() - 1000 + 500);
    expect(guestStart - 7777).toBeCloseTo(hostStart, 0);
  });
});
