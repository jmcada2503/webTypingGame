import { describe, expect, it } from 'vitest';
import { TransportError } from './errors';
import { browserName, connectPeer, type PeerConnection } from './rtc';
import { FakeNetwork, FakeRtc, FakeTimers, signalingPair, type FakeRtcOptions } from './testing';

function setup(options: FakeRtcOptions = {}) {
  const timers = new FakeTimers();
  const net = new FakeNetwork(timers);
  const rtc = new FakeRtc(net, options);
  const signals = signalingPair(timers);
  const common = { timers, createConnection: rtc.createConnection, userAgent: 'Chrome/130.0 Safari/537.36' };
  const host = connectPeer({ ...common, role: 'host', signaling: signals.host });
  const guest = connectPeer({ ...common, role: 'guest', signaling: signals.guest });
  const settle = (p: Promise<PeerConnection>) => p.then((v) => v, (e: unknown) => e as TransportError);
  return { timers, net, rtc, signals, host, guest, hostResult: settle(host.done), guestResult: settle(guest.done) };
}

describe('connecting', () => {
  it('connects both sides through offer / answer and opens the channel', async () => {
    const { timers, hostResult, guestResult } = setup();
    await timers.advanceAsync(3000);
    const host = (await hostResult) as PeerConnection;
    const guest = (await guestResult) as PeerConnection;
    const got: unknown[] = [];
    guest.link.onMessage((m) => got.push(m));
    host.link.send({ type: 'peace' });
    await timers.advanceAsync(200);
    expect(got).toEqual([{ type: 'peace' }]);
  });

  it('records the ICE timeline, time to connect and the kind of path', async () => {
    const { timers, hostResult } = setup({ pairType: 'srflx' });
    await timers.advanceAsync(3000);
    const { record } = (await hostResult) as PeerConnection;
    expect(record.role).toBe('host');
    expect(record.browser).toBe('Chrome 130');
    expect(record.pairType).toBe('srflx');
    expect(record.connectMs).toBeGreaterThan(0);
    expect(record.gatherMs).toBe(300);
    expect(record.iceTimeline.map((e) => e.state)).toEqual(['checking', 'connected']);
    expect(record.failure).toBeNull();
  });

  it('reports a relayed path as relay', async () => {
    const { timers, guestResult } = setup({ pairType: 'relay' });
    await timers.advanceAsync(3000);
    expect(((await guestResult) as PeerConnection).record.pairType).toBe('relay');
  });

  it('does not wait past the gather cap for candidates that never finish', async () => {
    const { timers, hostResult } = setup({ gatherMs: Infinity });
    // Each side waits the 1.5 s cap, then sends what it has: connected well before the 10 s timeout.
    await timers.advanceAsync(5000);
    const result = (await hostResult) as PeerConnection;
    expect(result).not.toBeInstanceOf(TransportError);
    expect(result.record.connectMs).toBeLessThan(5000);
    expect(result.record.gatherMs).toBeNull();
  });

  it('uses a reliable, ordered channel', async () => {
    // The fake throws if the host asks for an unordered channel; connecting without error proves it.
    const { timers } = setup();
    await expect(timers.advanceAsync(3000)).resolves.toBeUndefined();
  });
});

describe('connection errors', () => {
  it('iceFailed when ICE fails, with the timeline kept', async () => {
    const { timers, hostResult } = setup({ outcome: 'failed' });
    await timers.advanceAsync(3000);
    const error = (await hostResult) as TransportError;
    expect(error).toBeInstanceOf(TransportError);
    expect(error.kind).toBe('iceFailed');
    expect(error.record.failure).toBe('iceFailed');
    expect(error.record.iceTimeline.map((e) => e.state)).toContain('failed');
  });

  it('timeout when nothing happens within 10 s', async () => {
    const { timers, hostResult, guestResult } = setup({ outcome: 'never' });
    await timers.advanceAsync(9000);
    await timers.advanceAsync(1100);
    expect(((await hostResult) as TransportError).kind).toBe('timeout');
    expect(((await guestResult) as TransportError).kind).toBe('timeout');
  });

  it('signalingLost when the line through the backend dies before the channel opens', async () => {
    const { timers, signals, hostResult } = setup({ outcome: 'never' });
    await timers.advanceAsync(500);
    signals.host.lose();
    const error = (await hostResult) as TransportError;
    expect(error.kind).toBe('signalingLost');
  });

  it('keeps working if signaling dies after the channel opened', async () => {
    const { timers, signals, hostResult } = setup();
    await timers.advanceAsync(3000);
    const host = (await hostResult) as PeerConnection;
    signals.host.lose();
    await timers.advanceAsync(5000);
    host.link.send({ type: 'peace' });
    expect(host.record.failure).toBeNull();
  });

  it('aborted when the player gives up', async () => {
    const { timers, host, hostResult } = setup({ outcome: 'never' });
    await timers.advanceAsync(500);
    host.abort();
    expect(((await hostResult) as TransportError).kind).toBe('aborted');
  });

  it('closing a connection tells the opponent: peerLeft', async () => {
    const { timers, hostResult, guestResult } = setup();
    await timers.advanceAsync(3000);
    const host = (await hostResult) as PeerConnection;
    const guest = (await guestResult) as PeerConnection;
    const events: unknown[] = [];
    guest.link.onEvent((e) => events.push(e));
    host.close();
    await timers.advanceAsync(200);
    expect(events).toEqual([{ type: 'closed', error: 'peerLeft' }]);
  });
});

describe('browserName', () => {
  it.each([
    ['Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36', 'Chrome 130'],
    ['Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15', 'Safari 17'],
    ['Mozilla/5.0 (Macintosh; rv:125.0) Gecko/20100101 Firefox/125.0', 'Firefox 125'],
    ['Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0', 'Edge 130'],
    ['curl/8', 'unknown'],
  ])('%s', (ua, expected) => {
    expect(browserName(ua)).toBe(expected);
  });
});
