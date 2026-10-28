// PROTOTYPE (throwaway): "Prototype: Main menu screen".
// Question: what should the main menu look like in the ASCII CRT style? Practice, Public match,
// Private match, language selector, online count per language, and the "servers resting" state
// with the GitHub Sponsors message. Keyboard only.
//
// Four structurally different layouts (A list, B cards, C type-the-word, D split logo + status bar).
//   Switch layout:   [ and ]  (or the bar buttons, or ?variant=A..D)
//   Servers resting: \        (or the bar button, or ?state=resting)   <- prototype-only keys
//   B (chosen):      arrows or h/j/k/l move, 1-3 jump, Enter confirm, Tab = language, S = copy sponsor link.
//   A / D:           arrows / 1-3 / Enter, L = language, S = copy sponsor link.
//   In C every letter is typed into the prompt (practice, public, private, en, es, sponsor).
// Placeholder game name "TYPING GAME" and placeholder online numbers. No networking.
import * as THREE from 'three';
import '../../app/app.css';
import { AppShell } from '../../app/AppShell';
import type { GameSession, SessionStatus } from '../../app/GameSession';
import { KeyboardTypingInput } from '../../input/KeyboardTypingInput';
import type { PaletteColor, TextGrid } from '../../render/AsciiRenderer';
import type { GpuAsciiRenderer } from '../../render/GpuAsciiRenderer';
import { AsciiGameView } from '../../view/AsciiGameView';
import type { GameViewState } from '../../view/GameViewState';

type Variant = 'A' | 'B' | 'C' | 'D';
const VARIANTS: { key: Variant; name: string }[] = [
  { key: 'A', name: 'Classic list' },
  { key: 'B', name: 'Cards' },
  { key: 'C', name: 'Type the word' },
  { key: 'D', name: 'Split: logo + status bar' },
];
type Item = { key: 'practice' | 'public' | 'private'; label: string; word: string; desc: string; next: string; online: boolean };
const ITEMS: Item[] = [
  { key: 'practice', label: 'PRACTICE', word: 'practice', desc: 'PLAY ALONE. WORDS KEEP COMING UNTIL YOU RUN OUT OF LIVES.', next: 'starts Practice', online: false },
  { key: 'public', label: 'PUBLIC MATCH', word: 'public', desc: 'FACE A RANDOM OPPONENT ONLINE.', next: 'how-to screen, then Matchmaking', online: true },
  { key: 'private', label: 'PRIVATE MATCH', word: 'private', desc: 'PLAY A FRIEND. YOU GET AN INVITE LINK TO SHARE.', next: 'how-to screen, then your Invite link', online: true },
];

const COLS = 128;
const SPONSOR = 'https://github.com/sponsors/jmcada2503';

const params = new URLSearchParams(location.search);
let variant: Variant = (VARIANTS.find((v) => v.key === params.get('variant'))?.key ?? 'B') as Variant;
let resting = params.get('state') === 'resting';
let lang: 'EN' | 'ES' = 'EN';
let sel = 0;
let typed = '';
let toast: { msg: string; at: number } | null = null;
let copiedAt = -99;
const t0 = performance.now();
const now = () => (performance.now() - t0) / 1000;

class ProtoSession implements GameSession {
  status: SessionStatus = 'running';
  start() {}
  dispose() {}
  attachInput() {}
  update() {
    return [];
  }
  state(): GameViewState {
    return { lives: 3, typedWord: '', attackWord: '', wordBullets: [], shots: [], enemyDamage: 0, pace: { player: 0, enemy: 0 } };
  }
}

const session = new ProtoSession();
const input = new KeyboardTypingInput();
input.setEnabled(false);
const view = await AsciiGameView.create();
const hidden = view as unknown as { ascii: GpuAsciiRenderer; scene: THREE.Scene; overlay: THREE.Scene };
const text: TextGrid = hidden.ascii.textGrid;
const asciiRender = hidden.ascii.render.bind(hidden.ascii);
hidden.ascii.render = (scene, camera, overlay) => {
  drawVariant();
  asciiRender(scene, camera, overlay);
};
new AppShell(view, session, input).start();

// ---------------------------------------------------------------- helpers

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const put = (c: number, r: number, s: string, col?: PaletteColor) => text.write(Math.round(c), Math.round(r), s, col);
const centered = (r: number, s: string, col?: PaletteColor) => put((COLS - [...s].length) / 2, r, s, col);
const disabled = (i: number) => resting && ITEMS[i].online;
const blink = (t: number, hz = 2) => Math.floor(t * hz) % 2 === 0;

function wrap(s: string, w: number) {
  const out: string[] = [];
  let line = '';
  for (const word of s.split(' ')) {
    if ((line + ' ' + word).trim().length > w) {
      out.push(line);
      line = word;
    } else line = (line + ' ' + word).trim();
  }
  if (line) out.push(line);
  return out;
}

/** Placeholder online counts; they only change every 30 s, like the real (slightly stale) count. */
function online() {
  const step = Math.floor(now() / 30);
  const en = 97 + Math.round((hash(step) - 0.5) * 8);
  const es = 31 + Math.round((hash(step + 9) - 0.5) * 4);
  return { en, es, total: en + es, mine: lang === 'EN' ? en : es };
}
const langName = () => (lang === 'EN' ? 'ENGLISH' : 'SPANISH');

function box(c0: number, r0: number, w: number, h: number, color: PaletteColor = 'dim') {
  text.fill(c0, r0, w, h, ' ');
  put(c0, r0, '+' + '-'.repeat(w - 2) + '+', color);
  put(c0, r0 + h - 1, '+' + '-'.repeat(w - 2) + '+', color);
  for (let r = r0 + 1; r < r0 + h - 1; r++) {
    put(c0, r, '|', color);
    put(c0 + w - 1, r, '|', color);
  }
}

/** Game title (placeholder name), two-tone, at `scale`, left edge `c` (or centered if c is null). */
function title(row: number, scale: number, c: number | null = null) {
  const a = 'TYPING ';
  const b = 'GAME';
  const c0 = c ?? (COLS - ([...a].length + [...b].length) * scale) / 2;
  text.writeScaled(c0, row, a, scale, 'fg');
  text.writeScaled(c0 + [...a].length * scale, row, b, scale, 'yellow');
}

/** The "servers resting" message with the GitHub Sponsors link. Returns the rows used. */
function restingPanel(c0: number, row: number, w: number) {
  const inner = w - 6;
  const body = wrap('THE MONTHLY BUDGET THAT PAYS FOR THE ONLINE SERVERS IS USED UP, SO ONLINE MATCHES ARE PAUSED UNTIL IT RENEWS ON THE 1ST. PRACTICE STILL WORKS.', inner);
  const ask = wrap('WANT TO HELP KEEP THE GAME RUNNING? YOU CAN SUPPORT IT ON GITHUB SPONSORS:', inner);
  const h = body.length + ask.length + 6;
  box(c0, row, w, h, 'red');
  put(c0 + 3, row, ' SERVERS RESTING ', 'red');
  body.forEach((l, i) => put(c0 + 3, row + 2 + i, l, 'fg'));
  ask.forEach((l, i) => put(c0 + 3, row + 3 + body.length + i, l, 'dim'));
  const r = row + 3 + body.length + ask.length;
  put(c0 + 3, r, SPONSOR, 'yellow');
  const copied = now() - copiedAt < 1.6;
  put(c0 + w - 3 - 22, r + 1, copied ? 'COPIED!' : '[S] COPY SPONSOR LINK', copied ? 'green' : 'fg');
  return h;
}

/** A small, friendly ask shown while the servers are up. Returns the rows used. */
function sponsorNote(c0: number, row: number, w: number) {
  box(c0, row, w, 5, 'dim');
  put(c0 + 3, row + 1, 'WANT TO HELP KEEP THE GAME RUNNING?', 'fg');
  put(c0 + 3, row + 2, 'YOU CAN SUPPORT IT ON GITHUB SPONSORS:', 'dim');
  put(c0 + 3 + 40, row + 2, SPONSOR, 'yellow');
  const copied = now() - copiedAt < 1.6;
  put(c0 + w - 3 - 17, row + 3, copied ? 'COPIED!' : '[S] COPY LINK', copied ? 'green' : 'dim');
  return 5;
}

function drawToastAndFooter(footer: string) {
  if (toast && now() - toast.at < 2.4) centered(42, toast.msg, 'green');
  centered(43, footer, 'dim');
}

// ---------------------------------------------------------------- A: classic list

function drawA(t: number) {
  title(2, 3.4);
  centered(7.5, 'TYPE FAST. DEFEND. ATTACK.', 'dim');
  ITEMS.forEach((it, i) => {
    const row = 11.5 + i * 5.2;
    const off = disabled(i);
    const on = i === sel && !off;
    if (on && blink(t, 3)) put(34, row + 0.2, '>>', 'yellow');
    text.writeScaled(40, row, it.label, 1.6, off ? 'dim' : on ? 'fg' : 'dim');
    put(40 + [...it.label].length * 1.6 + 3, row + 0.5, off ? 'RESTING' : '', 'red');
    const o = online();
    put(40, row + 2.7, it.desc + (it.online && !off ? `   (${o.mine} ${langName()} PLAYERS ONLINE)` : ''), on ? 'fg' : 'dim');
  });
  put(40, 28.5, 'LANGUAGE', 'dim');
  put(52, 28.5, `<  ${langName().padEnd(7)}  >`, 'yellow');
  put(70, 28.5, 'WORDS AND MATCHMAKING USE THIS LANGUAGE', 'dim');
  if (resting) restingPanel(21, 31, 86);
  else {
    const o = online();
    centered(32, `ONLINE NOW ${o.total}      ENGLISH ${o.en}      SPANISH ${o.es}`, 'fg');
  }
  drawToastAndFooter('UP/DOWN SELECT   ENTER CONFIRM   LEFT/RIGHT LANGUAGE   1-3 JUMP');
}

// ---------------------------------------------------------------- B: cards

const ICONS: Record<Item['key'], string[]> = {
  practice: ['  .---.  ', ' ( (+) ) ', "  '---'  "],
  public: [' /\\   /\\ ', '/__\\ /__\\', '   VS    '],
  private: ['  .---.  ', ' | LINK | ', "  '---'  "],
};

function drawB(t: number) {
  title(1.5, 2.8);
  centered(6, 'TYPE FAST. DEFEND. ATTACK.', 'dim');
  const w = 36;
  ITEMS.forEach((it, i) => {
    const c0 = 6 + i * 40;
    const off = disabled(i);
    const on = i === sel && !off;
    box(c0, 9, w, 20, on ? (blink(t, 3) ? 'yellow' : 'fg') : 'dim');
    const lw = [...it.label].length * 1.4;
    text.writeScaled(c0 + (w - lw) / 2, 11, it.label, 1.4, off ? 'dim' : 'fg');
    ICONS[it.key].forEach((l, k) => put(c0 + (w - 9) / 2, 15 + k, l, off ? 'dim' : 'fg'));
    wrap(it.desc, 30).forEach((l, k) => put(c0 + 3, 20 + k, l, on ? 'fg' : 'dim'));
    if (off) put(c0 + (w - 7) / 2, 25, 'RESTING', 'red');
    else if (it.online) put(c0 + 3, 25, `${online().mine} ${langName()} PLAYERS ONLINE`, 'fg');
    else put(c0 + 3, 25, 'NO ONE ELSE NEEDED', 'fg');
    if (on) put(c0 + (w - 7) / 2, 27, '[ENTER]', 'yellow');
  });
  const o = online();
  centered(31, `[TAB] LANGUAGE:  <  ${langName()}  >      ONLINE NOW ${o.total}  (ENGLISH ${o.en}   SPANISH ${o.es})`, 'fg');
  if (resting) restingPanel(19, 33, 90);
  else sponsorNote(19, 34, 90);
  drawToastAndFooter('ARROWS OR H J K L CHOOSE   ENTER CONFIRM   TAB LANGUAGE   1-3 JUMP   S SPONSOR');
}

// ---------------------------------------------------------------- C: type the word

function drawC(t: number) {
  title(1.5, 2.6);
  const c0 = 22;
  const w = 84;
  box(c0, 8, w, 22, 'dim');
  put(c0 + 3, 8, ' MAIN MENU ', 'fg');
  put(c0 + 3, 10, '> WELCOME, PILOT. TYPE A WORD AND PRESS ENTER.', 'fg');
  const cmds = [...ITEMS.map((it) => it.word), ...(resting ? ['sponsor'] : [])];
  ITEMS.forEach((it, i) => {
    const row = 13 + i * 2;
    const off = disabled(i);
    const n = typed && it.word.startsWith(typed) ? typed.length : 0;
    put(c0 + 6, row, it.word.slice(0, n), 'green');
    put(c0 + 6 + n, row, it.word.slice(n), off ? 'dim' : 'fg');
    put(c0 + 22, row, off ? 'RESTING: ONLINE MATCHES ARE PAUSED' : it.desc, off ? 'red' : 'dim');
  });
  if (resting) {
    const n = typed && 'sponsor'.startsWith(typed) ? typed.length : 0;
    put(c0 + 6, 19, 'sponsor'.slice(0, n), 'green');
    put(c0 + 6 + n, 19, 'sponsor'.slice(n), 'yellow');
    put(c0 + 22, 19, 'SUPPORT THE SERVERS (COPIES THE LINK)', 'dim');
  }
  put(c0 + 6, 22, `language: ${langName().toLowerCase()}`, 'fg');
  put(c0 + 34, 22, 'TYPE en OR es TO CHANGE IT', 'dim');
  const o = online();
  put(c0 + 6, 24, `online now: ${o.total}  (english ${o.en}, spanish ${o.es})`, 'dim');
  const exact = cmds.includes(typed) || typed === 'en' || typed === 'es';
  put(c0 + 3, 27, '> ' + typed + (blink(t) ? '_' : ' '), typed && !exact && !cmds.some((c) => c.startsWith(typed)) && !'en'.startsWith(typed) && !'es'.startsWith(typed) ? 'red' : 'fg');
  if (exact) put(c0 + w - 12, 27, '[ENTER]', blink(t, 3) ? 'yellow' : 'fg');
  if (resting) restingPanel(19, 31, 90);
  drawToastAndFooter('TYPE A WORD   ENTER CONFIRM   BACKSPACE DELETE');
}

// ---------------------------------------------------------------- D: split logo + status bar

const BIG_SHIP = [
  '            ^',
  '           /|\\',
  '          / | \\',
  '         /  |  \\',
  '    ____/   |   \\____',
  '   /____    |    ____\\',
  '        \\___|___/',
];

function drawD(t: number) {
  for (let i = 0; i < 46; i++) {
    const c = 2 + Math.floor(hash(i * 3.3) * 62);
    const r = 2 + Math.floor(hash(i * 7.9) * 36);
    if (hash(i + Math.floor(t * 1.5 + i)) > 0.35) put(c, r, hash(i * 1.7) > 0.8 ? '+' : '.', 'dim');
  }
  title(4, 3.4, 6);
  put(7, 11.5, 'TYPE FAST. DEFEND. ATTACK.', 'dim');
  BIG_SHIP.forEach((l, i) => put(18, 17 + i + Math.round(Math.sin(t * 1.2)), l, 'fg'));
  const c0 = 70;
  box(c0, 5, 54, resting ? 22 : 24, 'dim');
  put(c0 + 3, 5, ' MAIN MENU ', 'fg');
  ITEMS.forEach((it, i) => {
    const row = 8 + i * 6;
    const off = disabled(i);
    const on = i === sel && !off;
    put(c0 + 4, row, on ? '>>' : '  ', 'yellow');
    text.writeScaled(c0 + 8, row - 0.3, `[${i + 1}] ${it.label}`, 1.4, off ? 'dim' : on ? 'fg' : 'dim');
    if (off) put(c0 + 8, row + 2, 'RESTING', 'red');
    else if (on) wrap(it.desc, 42).forEach((l, k) => put(c0 + 8, row + 2 + k, l, 'dim'));
  });
  const lr = resting ? 24 : 26;
  put(c0 + 4, lr, '[L] LANGUAGE', 'dim');
  put(c0 + 20, lr, `<  ${langName().padEnd(7)}  >`, 'yellow');
  if (resting) restingPanel(c0, 28, 54);
  else {
    const o = online();
    text.writeScaled(c0 + 4, 31, `${o.total} PLAYERS ONLINE`, 1.6, 'fg');
    put(c0 + 4, 34, `ENGLISH ${o.en}    SPANISH ${o.es}`, 'dim');
  }
  if (!resting) {
    const o = online();
    box(2, 37, 124, 3, 'dim');
    put(5, 38, `ONLINE ${o.total} | EN ${o.en} | ES ${o.es}`, 'dim');
    put(60, 38, `LANG ${langName()} | UP/DOWN + ENTER | 1-3 JUMP | L LANGUAGE`, 'dim');
  }
  if (toast && now() - toast.at < 2.4) centered(41, toast.msg, 'green');
}

function drawVariant() {
  const t = now();
  hidden.scene.visible = false;
  hidden.overlay.visible = false;
  text.clear();
  ({ A: drawA, B: drawB, C: drawC, D: drawD })[variant](t);
}

// ---------------------------------------------------------------- actions + keys

const say = (msg: string) => (toast = { msg, at: now() });
function confirm(i: number) {
  const it = ITEMS[i];
  if (disabled(i)) return say('ONLINE MATCHES ARE RESTING. TRY PRACTICE.');
  say(`ENTER: ${it.label} -> ${it.next}`);
}
function move(d: number) {
  for (let k = 1; k <= ITEMS.length; k++) {
    const i = (sel + d * k + ITEMS.length * 4) % ITEMS.length;
    if (!disabled(i)) return void (sel = i);
  }
}
const copySponsor = () => {
  copiedAt = now();
  void navigator.clipboard?.writeText(SPONSOR).catch(() => {});
};
function setResting(v: boolean) {
  resting = v;
  if (disabled(sel)) sel = 0;
  refreshBar();
}

function runTyped() {
  const w = typed.trim();
  typed = '';
  const i = ITEMS.findIndex((it) => it.word === w);
  if (i >= 0) return confirm(i);
  if (w === 'en' || w === 'es') {
    lang = w === 'en' ? 'EN' : 'ES';
    return say(`LANGUAGE: ${langName()}`);
  }
  if (w === 'sponsor' && resting) {
    copySponsor();
    return say('SPONSOR LINK COPIED');
  }
  if (w) say(`UNKNOWN WORD: ${w}`);
}

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (k === '[' || k === ']') return cycle(k === ']' ? 1 : -1);
  if (k === '\\') return setResting(!resting);
  if (variant === 'B') {
    if (k === 'Tab') {
      e.preventDefault();
      lang = lang === 'EN' ? 'ES' : 'EN';
    } else if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'l' || k === 'j') move(1);
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'h' || k === 'k') move(-1);
    else if (k === 'Enter') confirm(sel);
    else if (k === '1' || k === '2' || k === '3') {
      const i = Number(k) - 1;
      if (!disabled(i)) sel = i;
      confirm(i);
    } else if (k === 's' || k === 'S') copySponsor();
    return;
  }
  if (variant === 'C') {
    if (k === 'Enter') runTyped();
    else if (k === 'Backspace') typed = typed.slice(0, -1);
    else if (k.length === 1 && /[a-z]/i.test(k) && typed.length < 14) typed += k.toLowerCase();
    return;
  }
  if (k === 'ArrowDown') move(1);
  else if (k === 'ArrowUp') move(-1);
  else if (k === 'ArrowLeft' || k === 'ArrowRight') lang = lang === 'EN' ? 'ES' : 'EN';
  else if (k === 'Enter') confirm(sel);
  else if (k === '1' || k === '2' || k === '3') {
    const i = Number(k) - 1;
    if (!disabled(i)) sel = i;
    confirm(i);
  } else if (k === 'l' || k === 'L') lang = lang === 'EN' ? 'ES' : 'EN';
  else if ((k === 's' || k === 'S') && resting) copySponsor();
});

// ---------------------------------------------------------------- switcher bar (prototype-only)

const bar = document.createElement('div');
bar.style.cssText =
  'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:99999;display:flex;gap:10px;align-items:center;' +
  'padding:8px 14px;border-radius:999px;background:#ffd400;color:#000;font:600 14px system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.6)';
const mk = (label: string, onclick: () => void) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = 'border:0;background:#000;color:#ffd400;border-radius:999px;padding:4px 12px;font:inherit;cursor:pointer';
  b.onclick = () => {
    onclick();
    b.blur();
  };
  return b;
};
const label = document.createElement('span');
const stateBtn = mk('', () => setResting(!resting));
bar.append(mk('←', () => cycle(-1)), label, mk('→', () => cycle(1)), stateBtn);
document.body.append(bar);

function refreshBar() {
  const v = VARIANTS.find((x) => x.key === variant)!;
  label.textContent = `${v.key} (${v.name})  [ ]`;
  stateBtn.textContent = `servers: ${resting ? 'RESTING' : 'normal'} (\\)`;
  const p = new URLSearchParams(location.search);
  p.set('variant', variant);
  p.set('state', resting ? 'resting' : 'normal');
  history.replaceState(null, '', `?${p}`);
}
function cycle(d: number) {
  const i = VARIANTS.findIndex((v) => v.key === variant);
  variant = VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length].key;
  typed = '';
  refreshBar();
}
refreshBar();
