// PROTOTYPE (throwaway, branch prototype/keystroke-sounds): keystroke sounds generated in code (#157).
// Six ideas, ALL in the Arcade style (ZzFX square / triangle blips and crushed noise). Bad sounds (no-match letter, wrong submit) are shared so the
// comparison is about the *good* keystroke; Backspace is each idea's own. Per-press variation: pre-rendered variants + random rate / gain / pitch.
import { ZZFX } from '../audio/prototype-keystrokes/zzfx.js';

const ac = new AudioContext();
const master = ac.createGain();
master.connect(ac.destination);
const setVol = (v: number) => (master.gain.value = (v / 100) ** 2);
const volEl = document.getElementById('vol') as HTMLInputElement;
setVol(Number(volEl.value));
volEl.oninput = () => setVol(Number(volEl.value));

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const PENT = [0, 2, 4, 7, 9];
const pent = (n: number, base = 261.63) => base * 2 ** ((PENT[n % 5] + 12 * Math.floor(n / 5)) / 12);

// ---------- ZzFX (pre-rendered buffers) ----------
interface Z { f: number; vol?: number; att?: number; sus?: number; rel?: number; shape?: number; to?: number; noise?: number; crush?: number; filter?: number; curve?: number }
function z(o: Z): Float32Array {
  const att = o.att ?? 0, sus = o.sus ?? 0, rel = o.rel ?? 0.05;
  const slide = o.to !== undefined ? (o.to - o.f) / (500 * (att + sus + rel)) : 0;
  return ZZFX.buildSamples(o.vol ?? 0.3, 0, o.f, att, sus, rel, o.shape ?? 5, o.curve ?? 1, slide, 0, 0, 0, 0, o.noise ?? 0, 0, o.crush ?? 0, 0, 1, 0, 0, o.filter ?? 0);
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
function playBuf(b: AudioBuffer, rate = 1, gain = 1) {
  const s = ac.createBufferSource();
  const g = ac.createGain();
  s.buffer = b;
  s.playbackRate.value = rate;
  g.gain.value = gain;
  s.connect(g).connect(master);
  s.start();
}
const bufs = (n: number, make: (k: number) => Float32Array) => Array.from({ length: n }, (_, k) => toBuffer(make(k)));

// ---------- shared BAD sounds (the Arcade ones decided in the sound style ticket) ----------
const noMatchBufs = bufs(3, (k) => z({ f: 150 + k * 8, sus: 0.02, rel: 0.05, vol: 0.32, shape: 2, crush: 0.25 }));
const wrongBuf = toBuffer(mixBuf([z({ f: 220, to: 160, sus: 0.06, rel: 0.06, vol: 0.35, shape: 2, crush: 0.3 })], [z({ f: 150, to: 90, sus: 0.08, rel: 0.1, vol: 0.38, shape: 2, crush: 0.3 }), 0.11]));
const noMatch = () => playBuf(pick(noMatchBufs), rnd(0.95, 1.05));
const wrongSubmit = () => playBuf(wrongBuf);
// the RIGHT submit = a Word bullet destroyed (Arcade, from the sound style ticket): crushed noise burst + a rising C-E-G arpeggio. No key sound with it.
const sqz = (f: number, rel: number, vol: number) => z({ f, rel, vol, shape: 5 });
const destroyedBuf = toBuffer(mixBuf([z({ f: 400, rel: 0.12, vol: 0.3, shape: 4, crush: 0.2 })], [sqz(1046.5, 0.04, 0.22), 0.01], [sqz(1318.5, 0.04, 0.22), 0.04], [sqz(1568, 0.06, 0.22), 0.07]));
const rightSubmit = () => playBuf(destroyedBuf);

// ---------- the six ideas, all Arcade: ZzFX square / triangle blips and crushed noise, pre-rendered ----------
interface Idea {
  name: string;
  how: string;
  /** i = index of the letter in the word (0 = first), ch = the letter. */
  match(i: number, ch: string): void;
  back(): void;
}
const sq = (f: number, rel = 0.035, vol = 0.08, extra: Partial<Z> = {}) => z({ f, rel, vol, shape: 5, curve: 0.6, ...extra });
const back1 = (f: number, to: number) => bufs(1, () => z({ f, to, rel: 0.04, vol: 0.12, shape: 1 }))[0];
const upDown = (r: number) => rnd(1 - r, 1 + r);

// 1. climb: one pentatonic step up per matching letter, resets each word
const I1 = Array.from({ length: 14 }, (_, n) => toBuffer(sq(pent(n, 440))));
// 2. arp: cycles C-E-G (the "good = rising major arpeggio" of the style), one note per press
const I2 = [523.25, 659.25, 783.99].map((f) => toBuffer(sq(f, 0.04)));
// 3. hat: crushed noise tick like an NES hi-hat, a hint of square under it
const I3 = bufs(5, (k) => mixBuf([z({ f: 5000 + k * 300, shape: 4, rel: 0.018, vol: 0.14, crush: 0.5, filter: 2500 })], [sq(1800 + k * 60, 0.012, 0.05), 0]));
// 4. melody: triangle blip per letter (A-Z on two octaves of pentatonic), typing a word plays a tune
const I4 = Array.from({ length: 10 }, (_, n) => toBuffer(z({ f: pent(n, 440), rel: 0.05, vol: 0.2, shape: 1 })));
// 5. chirp: a tiny rising square slide (a baby cousin of the Attack pew), 3 pitches
const I5 = bufs(3, (k) => z({ f: 900 + k * 120, to: 1500 + k * 160, rel: 0.03, vol: 0.08, shape: 5, curve: 0.6 }));
// 6. thump: tiny drum: falling triangle plus a noise puff, 4 variants
const I6 = bufs(4, (k) => mixBuf([z({ f: 260 + k * 15, to: 90, rel: 0.04, vol: 0.28, shape: 1 })], [z({ f: 1200, shape: 4, rel: 0.012, vol: 0.1, crush: 0.4, filter: 1500 }), 0]));

const IDEAS: Idea[] = [
  { name: '1 · Climb', how: 'square blip, one pentatonic step up per matching letter, resets each word',
    match: (i) => playBuf(I1[Math.min(i, 13)], rnd(0.997, 1.003)), back: () => playBuf(back1(700, 420), upDown(0.03)) },
  { name: '2 · Arp', how: 'square blips cycling C-E-G (rising major arpeggio, the style\'s "good")',
    match: (i) => playBuf(I2[i % 3], rnd(0.995, 1.005)), back: () => playBuf(back1(660, 440), upDown(0.03)) },
  { name: '3 · Hat', how: 'crushed-noise tick like an NES hi-hat with a square hint, 5 variants',
    match: () => playBuf(pick(I3), upDown(0.06), rnd(0.85, 1)), back: () => playBuf(back1(1400, 700), upDown(0.03)) },
  { name: '4 · Melody', how: 'triangle blip per letter: pitch follows the letter, words play a tune',
    match: (_i, ch) => playBuf(I4[(ch.charCodeAt(0) - 97) % 10], rnd(0.997, 1.003)), back: () => playBuf(back1(500, 300), upDown(0.03)) },
  { name: '5 · Chirp', how: 'tiny rising square slide, a baby cousin of the Attack pew, 3 pitches',
    match: () => playBuf(pick(I5), upDown(0.04)), back: () => playBuf(back1(1100, 600), upDown(0.03)) },
  { name: '6 · Thump', how: 'tiny drum: falling triangle plus a noise puff, 4 variants',
    match: () => playBuf(pick(I6), upDown(0.05), rnd(0.85, 1)), back: () => playBuf(back1(300, 120), upDown(0.03)) },
];

// ---------- the little typing game ----------
const WORDS = ['signal', 'orbit', 'cannon', 'shield', 'vector', 'plasma', 'engine', 'target', 'beacon', 'launch', 'radar', 'photon', 'hull', 'thruster', 'sector', 'comet'];
let cur = 0;
let word = pick(WORDS);
let typed = '';
let counts = { match: 0, no: 0, back: 0, wrong: 0, ok: 0 };
const wordEl = document.getElementById('word')!, typedEl = document.getElementById('typed')!, lastEl = document.getElementById('last')!, statsEl = document.getElementById('stats')!;
const variantsEl = document.getElementById('variants')!;
IDEAS.forEach((it, i) => {
  const b = document.createElement('button');
  b.innerHTML = `${it.name}<small>${it.how}</small>`;
  b.onclick = () => select(i);
  variantsEl.appendChild(b);
});
function select(i: number) {
  cur = i;
  [...variantsEl.children].forEach((c, k) => c.classList.toggle('on', k === i));
}
function render(last = '') {
  wordEl.textContent = word.toUpperCase();
  const ok = [...typed].map((c, i) => (c === word[i] ? 'ok' : 'bad'));
  typedEl.innerHTML = [...typed].map((c, i) => `<span class="${ok[i]}">${c.toUpperCase()}</span>`).join('');
  if (last) lastEl.textContent = last;
  statsEl.textContent = `match ${counts.match} · no-match ${counts.no} · backspace ${counts.back} · wrong submit ${counts.wrong} · words ${counts.ok}`;
}
function press(key: string) {
  void ac.resume();
  if (key === 'Backspace') {
    if (!typed) return;
    typed = typed.slice(0, -1);
    counts.back++;
    IDEAS[cur].back();
    render('backspace (neutral, own sound)');
  } else if (key === 'Enter') {
    if (typed === word) {
      counts.ok++;
      word = pick(WORDS.filter((w) => w !== word));
      typed = '';
      rightSubmit();
      render('right submit = Word bullet destroyed (good; no key sound under it)');
    } else {
      counts.wrong++;
      wrongSubmit();
      render('wrong submit (bad, shared)');
    }
  } else if (/^[a-z]$/.test(key)) {
    const matching = word.startsWith(typed + key) && word.startsWith(typed);
    const i = typed.length;
    typed += key;
    if (matching) {
      counts.match++;
      IDEAS[cur].match(i, key);
      render(`match, letter ${i + 1} (good, idea ${cur + 1})`);
    } else {
      counts.no++;
      noMatch();
      render('no match (bad, shared)');
    }
  }
}
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (/^[1-6]$/.test(e.key)) return select(Number(e.key) - 1);
  if (e.repeat) return;
  press(e.key.length === 1 ? e.key.toLowerCase() : e.key);
});
const on = (id: string, f: () => void) => ((document.getElementById(id) as HTMLButtonElement).onclick = () => { void ac.resume(); f(); });
on('a-match', () => IDEAS[cur].match(Math.floor(rnd(0, 6)), pick([...'abcdefghij'])));
on('a-no', noMatch);
on('a-back', () => IDEAS[cur].back());
on('a-wrong', wrongSubmit);
on('a-right', rightSubmit);

// Burst test: types the word at N keys/s, every 6th word with a typo (backspaced), to hear fatigue.
let timer: number | null = null;
function auto(rate: number, btn: string) {
  const el = document.getElementById(btn)!;
  if (timer !== null) { clearInterval(timer); timer = null; document.querySelectorAll('#auto,#auto2').forEach((b) => b.classList.remove('on')); return; }
  el.classList.add('on');
  let n = 0;
  let queue: string[] = [];
  timer = window.setInterval(() => {
    if (!queue.length) {
      n++;
      const typo = n % 6 === 0;
      queue = [...word].flatMap((c, i) => (typo && i === 2 ? ['x', 'Backspace', c] : [c]));
      queue.push('Enter');
    }
    press(queue.shift()!);
  }, 1000 / rate);
}
on('auto', () => auto(10, 'auto'));
on('auto2', () => auto(14, 'auto2'));

select(0);
render('click the page, then type');
