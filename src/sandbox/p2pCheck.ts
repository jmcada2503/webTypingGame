// Manual two-tab check of the P2P transport: real WebRTC, signaling over a BroadcastChannel.
import { connectPeer, type PeerConnection, type PendingConnection, type SignalMessage } from '../net/rtc';

const log = document.getElementById('log') as HTMLPreElement;
const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
const print = (line: string) => {
  log.textContent += `${new Date().toLocaleTimeString()}  ${line}\n`;
  log.scrollTop = log.scrollHeight;
};

const bus = new BroadcastChannel('p2p-check');
const tabId = Math.random().toString(36).slice(2, 6);
let pending: PendingConnection | null = null;
let connection: PeerConnection | null = null;
let shots = 0;

/** Signaling over the BroadcastChannel: the other tab's messages in, ours out. */
function signaling() {
  const handlers = new Set<(message: SignalMessage) => void>();
  bus.onmessage = (event: MessageEvent<{ from: string; message: SignalMessage }>) => {
    if (event.data.from !== tabId) handlers.forEach((h) => h(event.data.message));
  };
  return {
    send: (message: SignalMessage) => bus.postMessage({ from: tabId, message }),
    onMessage(cb: (message: SignalMessage) => void) {
      handlers.add(cb);
      return () => void handlers.delete(cb);
    },
    onLost: () => () => {},
  };
}

async function start(role: 'host' | 'guest') {
  print(`${role}: connecting...`);
  button('host').disabled = button('join').disabled = true;
  pending = connectPeer({ role, signaling: signaling() });
  try {
    connection = await pending.done;
  } catch (error) {
    const { kind, record } = error as { kind: string; record: unknown };
    print(`FAILED: ${kind}\n${JSON.stringify(record, null, 2)}`);
    button('host').disabled = button('join').disabled = false;
    return;
  }
  const { link, record } = connection;
  print(`CONNECTED in ${record.connectMs} ms via ${record.pairType ?? '?'} (${record.browser})`);
  print(`ice: ${record.iceTimeline.map((e) => `${e.state}@${e.atMs}`).join(' → ')}`);
  link.onMessage((message) => print(`received ${JSON.stringify(message)}`));
  link.onEvent((event) => print(`link: ${JSON.stringify(event)}`));
  setInterval(() => {
    if (link.rttMs !== null) print(`rtt ${link.rttMs.toFixed(1)} ms, clock offset ${link.clockOffsetMs?.toFixed(1)} ms`);
  }, 10_000);
  button('send').disabled = button('leave').disabled = false;
  if (role === 'host') {
    // Countdown sync check: both tabs should print the same wall time.
    setTimeout(() => {
      const at = link.startIn(3000);
      print(`startAt in 3 s (local ${at.toFixed(0)})`);
      setTimeout(() => print(`START (host) at ${performance.now().toFixed(0)}`), 3000);
    }, 1500);
  } else {
    link.onMessage((message) => {
      if (message.type !== 'startAt') return;
      const local = link.toLocalTime(message.at);
      setTimeout(() => print(`START (guest) at ${performance.now().toFixed(0)}`), local - performance.now());
    });
  }
}

button('host').onclick = () => void start('host');
button('join').onclick = () => void start('guest');
button('send').onclick = () => {
  connection?.link.send({ type: 'shot', i: shots, t: shots, word: `test${shots}` });
  print(`sent shot ${shots++}`);
};
button('leave').onclick = () => {
  (connection?.close(), pending?.abort());
  print('left');
  button('send').disabled = button('leave').disabled = true;
};
