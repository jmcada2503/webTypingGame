// PROTOTYPE (keystroke sounds, throwaway, dev only): Climb (A), Thump (C) and four combinations of them (D-G) in the real game, to feel them in Practice.
// Switch with ?variant=A|C|D|E|F|G, the bottom bar, or Alt+Left / Alt+Right (letters are typed in the Match, so no plain keys).
// Hooks only watch the game (typing input, host events); nothing in the game changes. All sounds are Arcade (ZzFX), as decided in #154.
import type { TypingInput } from '../../input/TypingInput';
import type { ScreenHost } from '../../screens/ScreenHost';
import type { ViewEvent } from '../../view/GameViewState';
import { ZZFX } from './zzfx.js';

const ac = new AudioContext();
const master = ac.createGain();
master.gain.value = 0.7;
master.connect(ac.destination);

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const PENT = [0, 2, 4, 7, 9];
const pent = (n: number, base = 261.63) => base * 2 ** ((PENT[n % 5] + 12 * Math.floor(n / 5)) / 12);

interface Z { f: number; vol?: number; sus?: number; rel?: number; shape?: number; to?: number; crush?: number; filter?: number; curve?: number }
function z(o: Z): Float32Array {
  const sus = o.sus ?? 0, rel = o.rel ?? 0.05;
  const slide = o.to !== undefined ? (o.to - o.f) / (500 * (sus + rel)) : 0;
  return ZZFX.buildSamples(o.vol ?? 0.3, 0, o.f, 0, sus, rel, o.shape ?? 5, o.curve ?? 1, slide, 0, 0, 0, 0, 0, 0, o.crush ?? 0, 0, 1, 0, 0, o.filter ?? 0);
}
const mixBuf = (...parts: [Float32Array, number?][]) => {
  const len = Math.max(...parts.map(([b, d]) => b.length + Math.round((d ?? 0) * ZZFX.sampleRate)));
  const out = new Float32Array(len);
  for (const [b, d] of parts) {
    const o = Math.round((d ?? 0) * ZZFX.sampleRate);
    for (let i = 0; i < b.length; i++) out[o + i] += b[i];
  }
  return out;
};
const toBuffer = (s: Float32Array) => {
  const b = ac.createBuffer(1, s.length, ZZFX.sampleRate);
  b.copyToChannel(s as Float32Array<ArrayBuffer>, 0);
  return b;
};
const bufs = (n: number, make: (k: number) => Float32Array) => Array.from({ length: n }, (_, k) => toBuffer(make(k)));
function play(b: AudioBuffer, rate = 1, gain = 1) {
  if (ac.state !== 'running') return;
  const s = ac.createBufferSource();
  const g = ac.createGain();
  s.buffer = b;
  s.playbackRate.value = rate;
  g.gain.value = gain;
  s.connect(g).connect(master);
  s.start();
}
const upDown = (r: number) => rnd(1 - r, 1 + r);

// Shared sounds (Arcade, from the sound style ticket).
const noMatchBufs = bufs(3, (k) => z({ f: 150 + k * 8, sus: 0.02, rel: 0.05, vol: 0.32, shape: 2, crush: 0.25 }));
const wrongBuf = toBuffer(mixBuf([z({ f: 220, to: 160, sus: 0.06, rel: 0.06, vol: 0.35, shape: 2, crush: 0.3 })], [z({ f: 150, to: 90, sus: 0.08, rel: 0.1, vol: 0.38, shape: 2, crush: 0.3 }), 0.11]));
const sqz = (f: number, rel: number, vol: number) => z({ f, rel, vol, shape: 5 });
const destroyedBuf = toBuffer(mixBuf([z({ f: 400, rel: 0.12, vol: 0.3, shape: 4, crush: 0.2 })], [sqz(1046.5, 0.04, 0.22), 0.01], [sqz(1318.5, 0.04, 0.22), 0.04], [sqz(1568, 0.06, 0.22), 0.07]));
const lifeLostBuf = toBuffer(mixBuf([z({ f: 90, sus: 0.08, rel: 0.5, vol: 0.6, shape: 4, crush: 0.6 })], [z({ f: 260, to: 40, sus: 0.1, rel: 0.35, vol: 0.45, shape: 2, crush: 0.4 })]));
const enemyFiredBuf = toBuffer(z({ f: 900, to: 260, sus: 0.05, rel: 0.15, vol: 0.18, shape: 2, filter: -1400 }));

const sq = (f: number, rel = 0.035, vol = 0.08) => z({ f, rel, vol, shape: 5, curve: 0.6 });
const back1 = (f: number, to: number) => toBuffer(z({ f, to, rel: 0.04, vol: 0.12, shape: 1 }));

/** `i` = index of the letter in the word (0 = first); `done` = the typed word is now exactly a Word bullet / the Attack word. */
interface Idea { key: string; name: string; match(i: number, done: boolean): void; back(): void }
const climb = Array.from({ length: 14 }, (_, n) => toBuffer(sq(pent(n, 440))));
const thump = bufs(4, (k) => mixBuf([z({ f: 260 + k * 15, to: 90, rel: 0.04, vol: 0.28, shape: 1 })], [z({ f: 1200, shape: 4, rel: 0.012, vol: 0.1, crush: 0.4, filter: 1500 }), 0]));
// a thump whose starting pitch climbs the pentatonic scale with the letter (one sound doing both jobs)
const climbThump = Array.from({ length: 14 }, (_, n) => toBuffer(mixBuf([z({ f: pent(n, 300), to: pent(n, 300) * 0.35, rel: 0.045, vol: 0.28, shape: 1 })], [z({ f: 1200, shape: 4, rel: 0.012, vol: 0.1, crush: 0.4, filter: 1500 }), 0])));
const backClimb = back1(700, 420);
const backThump = back1(300, 120);
const doClimb = (i: number) => play(climb[Math.min(i, 13)], rnd(0.997, 1.003));
const doThump = (gain = 1) => play(pick(thump), upDown(0.05), rnd(0.85, 1) * gain);
const IDEAS: Idea[] = [
  { key: 'A', name: 'Climb', match: (i) => doClimb(i), back: () => play(backClimb, upDown(0.03)) },
  { key: 'C', name: 'Thump', match: () => doThump(), back: () => play(backThump, upDown(0.03)) },
  { key: 'D', name: 'Layered: climb blip over a soft thump', match: (i) => (doClimb(i), doThump(0.6)), back: () => play(backThump, upDown(0.03)) },
  { key: 'E', name: 'Thump opens the word, then climb', match: (i) => (i === 0 ? doThump() : doClimb(i)), back: () => play(backClimb, upDown(0.03)) },
  { key: 'F', name: 'Climbing thump (one sound, pitch rises)', match: (i) => play(climbThump[Math.min(i, 13)], rnd(0.997, 1.003)), back: () => play(backThump, upDown(0.03)) },
  { key: 'G', name: 'Climb, thump when the word is complete', match: (i, done) => (doClimb(i), done && doThump(1.2)), back: () => play(backClimb, upDown(0.03)) },
];

const same = (a: string, b: string) => a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase();

export function installKeystrokePrototype(host: ScreenHost, input: TypingInput) {
  let cur = Math.max(0, IDEAS.findIndex((i) => i.key === (new URLSearchParams(location.search).get('variant') ?? 'A').toUpperCase()));

  const bar = document.createElement('div');
  Object.assign(bar.style, { position: 'fixed', bottom: '14px', left: '50%', transform: 'translateX(-50%)', zIndex: '99999', background: '#fff', color: '#000', font: '14px monospace', padding: '8px 16px', borderRadius: '99px', boxShadow: '0 2px 12px #000', cursor: 'pointer', userSelect: 'none' });
  const refresh = () => (bar.textContent = `◀  ${IDEAS[cur].key} — ${IDEAS[cur].name}  ▶   (Alt+←/→)`);
  const cycle = (d: number) => {
    cur = (cur + d + IDEAS.length) % IDEAS.length;
    const p = new URLSearchParams(location.search);
    p.set('variant', IDEAS[cur].key);
    history.replaceState(null, '', `${location.pathname}?${p}${location.hash}`);
    refresh();
  };
  bar.onclick = (e) => cycle(e.clientX < bar.getBoundingClientRect().left + bar.offsetWidth / 2 ? -1 : 1);
  document.body.appendChild(bar);
  refresh();

  const unlock = () => void (ac.state !== 'running' && ac.resume());
  addEventListener('keydown', unlock, true);
  addEventListener('pointerdown', unlock, true);
  addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      cycle(e.key === 'ArrowLeft' ? -1 : 1);
    }
  });

  // Typing: matching / no-match / Backspace / wrong submit. Subscribed before any Match, so it runs before the engine's own handler.
  let prevWord = '';
  let submitted = false;
  input.onSubmit((word) => {
    const s = host.state();
    const ok = s.wordBullets.some((b) => same(b.word, word)) || (s.attackWord !== '' && same(s.attackWord, word));
    if (!ok) play(wrongBuf);
    submitted = true;
  });
  input.onChange((word) => {
    const was = prevWord;
    prevWord = word;
    if (submitted) return void (submitted = false);
    if (host.screenShown !== 'match') return;
    if (word.length > was.length) {
      const s = host.state();
      const targets = [...s.wordBullets.map((b) => b.word), s.attackWord].filter(Boolean);
      if (targets.some((t) => t.normalize('NFC').toLowerCase().startsWith(word))) IDEAS[cur].match(word.length - 1, targets.some((t) => same(t, word)));
      else play(pick(noMatchBufs), upDown(0.05));
    } else if (word.length === was.length - 1) IDEAS[cur].back();
  });

  // The right submit (Word bullet destroyed) and the two Lives sounds, so the keystrokes are heard among real events.
  const original = host.update.bind(host);
  host.update = (dt: number): ViewEvent[] => {
    const events = original(dt);
    for (const e of events) {
      if (e.type === 'wordBulletDestroyed') play(destroyedBuf);
      else if (e.type === 'lifeLost') play(lifeLostBuf);
      else if (e.type === 'enemyFired') play(enemyFiredBuf);
    }
    return events;
  };
}
