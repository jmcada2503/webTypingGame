// PROTOTYPE (throwaway): "Prototype: Screen transition (TV channel change / turn off-on)".
// The three approved screens (main menu B, how-to B, waiting C3) connected into one flow, with a
// screen-change effect between them. Four effects to compare (shader in ScreenFilters.ts):
//   1 Channel flip (roll + tearing + snow)   2 TV off/on (collapse to a line, then a dot, and back)
//   3 Static cut (short burst of snow)       4 Glitch (jumping slices + color split)
//
// Flow:  MENU --Enter on Public/Private--> HOW-TO --Enter or 30 s--> WAITING --Q--> MENU
//   Practice is a stub. Input is locked while the effect plays.
// Prototype-only keys:  [ and ] change the effect   \ menu servers resting   F "opponent found" (toast)
//   R replay the last transition on the current screen (to judge the effect without navigating)
// Real renderer + CRT filter. Placeholder game name, online numbers and sponsor link. No networking.
import * as THREE from 'three';
import '../../app/app.css';
import { AppShell } from '../../app/AppShell';
import type { GameSession, SessionStatus } from '../../app/GameSession';
import { KeyboardTypingInput } from '../../input/KeyboardTypingInput';
import type { PaletteColor, TextGrid } from '../../render/AsciiRenderer';
import type { GpuAsciiRenderer } from '../../render/GpuAsciiRenderer';
import { SCREEN_TRANSITION } from '../../render/ScreenFilters';
import { AsciiGameView } from '../../view/AsciiGameView';
import type { GameViewState } from '../../view/GameViewState';

// ---------------------------------------------------------------- state

type ScreenId = 'menu' | 'howto' | 'waiting';
type Kind = 'public' | 'private';
type Fx = { mode: number; name: string; out: number; in: number };
const EFFECTS: Fx[] = [
  { mode: 1, name: 'Channel flip', out: 0.28, in: 0.34 },
  { mode: 2, name: 'TV off / on', out: 0.3, in: 0.4 },
  { mode: 3, name: 'Static cut', out: 0.18, in: 0.22 },
  { mode: 4, name: 'Glitch', out: 0.22, in: 0.28 },
];

const COLS = 128;
const SPONSOR = 'https://github.com/sponsors/jmcada2503';
const LINK = 'https://typingame.example/#/m/K7Q2-9XPD';
const AUTO_SECONDS = 30;

const params = new URLSearchParams(location.search);
let fxIndex = Math.max(0, Number(params.get('fx') ?? 1) - 1) % EFFECTS.length;
let screen: ScreenId = (['menu', 'howto', 'waiting'].includes(params.get('screen') ?? '') ? params.get('screen') : 'menu') as ScreenId;
let kind: Kind = params.get('kind') === 'private' ? 'private' : 'public';
let resting = params.get('state') === 'resting';
let lang: 'EN' | 'ES' = 'EN';
let sel = 0;
let toast: { msg: string; at: number } | null = null;
let copiedAt = -99;

const t0 = performance.now();
const clock = () => (performance.now() - t0) / 1000;
let screenStart = clock();
const screenT = () => clock() - screenStart;

/** The running screen change: `out` ramps the effect up, then we swap screens, then `in` ramps it down. */
let trans: { phase: 'out' | 'in'; t: number; to: ScreenId; toKind: Kind; fx: Fx } | null = null;

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
let lastFrame = performance.now();
const asciiRender = hidden.ascii.render.bind(hidden.ascii);
hidden.ascii.render = (scene, camera, overlay) => {
  const nowMs = performance.now();
  tickTransition(Math.min((nowMs - lastFrame) / 1000, 0.1));
  lastFrame = nowMs;
  hidden.scene.visible = false;
  hidden.overlay.visible = false;
  text.clear();
  ({ menu: drawMenu, howto: drawHowto, waiting: drawWaiting })[screen](screenT());
  if (toast && clock() - toast.at < 2.4) centered(0.3, toast.msg, 'green');
  asciiRender(scene, camera, overlay);
};
new AppShell(view, session, input).start();

// ---------------------------------------------------------------- transition

function go(to: ScreenId, toKind: Kind = kind) {
  if (trans) return;
  trans = { phase: 'out', t: 0, to, toKind, fx: EFFECTS[fxIndex] };
  SCREEN_TRANSITION.mode = trans.fx.mode;
}

// ?lvl=0.7 holds the effect at that strength (for reviewing stills); the flow itself still works.
const holdLevel = params.get('lvl') !== null ? Number(params.get('lvl')) : null;

function tickTransition(dt: number) {
  if (holdLevel !== null) {
    SCREEN_TRANSITION.mode = EFFECTS[fxIndex].mode;
    SCREEN_TRANSITION.level = holdLevel;
    return;
  }
  if (!trans) {
    SCREEN_TRANSITION.level = 0;
    return;
  }
  trans.t += dt;
  const dur = trans.phase === 'out' ? trans.fx.out : trans.fx.in;
  const u = Math.min(1, trans.t / dur);
  if (trans.phase === 'out') {
    SCREEN_TRANSITION.level = u * u; // accelerates into the effect
    if (u >= 1) {
      screen = trans.to;
      kind = trans.toKind;
      screenStart = clock();
      trans = { ...trans, phase: 'in', t: 0 };
    }
  } else {
    SCREEN_TRANSITION.level = (1 - u) * (1 - u); // settles quickly
    if (u >= 1) {
      trans = null;
      SCREEN_TRANSITION.level = 0;
    }
  }
}

// ---------------------------------------------------------------- helpers

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const put = (c: number, r: number, s: string, col?: PaletteColor) => text.write(Math.round(c), Math.round(r), s, col);
const centered = (r: number, s: string, col?: PaletteColor) => put((COLS - [...s].length) / 2, r, s, col);
const blink = (t: number, hz = 2) => Math.floor(t * hz) % 2 === 0;
const say = (msg: string) => (toast = { msg, at: clock() });
const langName = () => (lang === 'EN' ? 'ENGLISH' : 'SPANISH');

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

function box(c0: number, r0: number, w: number, h: number, color: PaletteColor = 'dim') {
  text.fill(c0, r0, w, h, ' ');
  put(c0, r0, '+' + '-'.repeat(w - 2) + '+', color);
  put(c0, r0 + h - 1, '+' + '-'.repeat(w - 2) + '+', color);
  for (let r = r0 + 1; r < r0 + h - 1; r++) {
    put(c0, r, '|', color);
    put(c0 + w - 1, r, '|', color);
  }
}

/** Placeholder online counts; they only change every 30 s (stale is fine). */
function online() {
  const step = Math.floor(clock() / 30);
  const en = 97 + Math.round((hash(step) - 0.5) * 8);
  const es = 31 + Math.round((hash(step + 9) - 0.5) * 4);
  return { en, es, total: en + es, mine: lang === 'EN' ? en : es };
}

function twoTone(row: number, a: string, b: string, scale: number, c: number | null = null) {
  const c0 = c ?? (COLS - ([...a].length + [...b].length) * scale) / 2;
  text.writeScaled(c0, row, a, scale, 'fg');
  text.writeScaled(c0 + [...a].length * scale, row, b, scale, 'yellow');
}

// ================================================================ MENU (layout B)

type Item = { key: 'practice' | 'public' | 'private'; label: string; desc: string; next: string; online: boolean };
const ITEMS: Item[] = [
  { key: 'practice', label: 'PRACTICE', desc: 'PLAY ALONE. WORDS KEEP COMING UNTIL YOU RUN OUT OF LIVES.', next: 'starts Practice', online: false },
  { key: 'public', label: 'PUBLIC MATCH', desc: 'FACE A RANDOM OPPONENT ONLINE.', next: 'how-to screen', online: true },
  { key: 'private', label: 'PRIVATE MATCH', desc: 'PLAY A FRIEND. YOU GET AN INVITE LINK TO SHARE.', next: 'how-to screen', online: true },
];
const ICONS: Record<Item['key'], string[]> = {
  practice: ['  .---.  ', ' ( (+) ) ', "  '---'  "],
  public: [' /\\   /\\ ', '/__\\ /__\\', '   VS    '],
  private: ['  .---.  ', ' | LINK | ', "  '---'  "],
};
const disabled = (i: number) => resting && ITEMS[i].online;

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
  const copied = clock() - copiedAt < 1.6;
  put(c0 + w - 3 - 22, r + 1, copied ? 'COPIED!' : '[S] COPY SPONSOR LINK', copied ? 'green' : 'fg');
}

function sponsorNote(c0: number, row: number, w: number) {
  box(c0, row, w, 5, 'dim');
  put(c0 + 3, row + 1, 'WANT TO HELP KEEP THE GAME RUNNING?', 'fg');
  put(c0 + 3, row + 2, 'YOU CAN SUPPORT IT ON GITHUB SPONSORS:', 'dim');
  put(c0 + 3 + 40, row + 2, SPONSOR, 'yellow');
  const copied = clock() - copiedAt < 1.6;
  put(c0 + w - 3 - 17, row + 3, copied ? 'COPIED!' : '[S] COPY LINK', copied ? 'green' : 'dim');
}

function drawMenu(t: number) {
  twoTone(1.5, 'TYPING ', 'GAME', 2.8);
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
  centered(43, 'ARROWS OR H J K L CHOOSE   ENTER CONFIRM   TAB LANGUAGE   1-3 JUMP   S SPONSOR', 'dim');
}

function moveSel(d: number) {
  for (let k = 1; k <= ITEMS.length; k++) {
    const i = (sel + d * k + ITEMS.length * 4) % ITEMS.length;
    if (!disabled(i)) return void (sel = i);
  }
}
function confirmMenu(i: number) {
  const it = ITEMS[i];
  if (disabled(i)) return say('ONLINE MATCHES ARE RESTING. TRY PRACTICE.');
  if (it.key === 'practice') return say('PRACTICE: not part of this prototype');
  go('howto', it.key === 'private' ? 'private' : 'public');
}
const copySponsor = () => {
  copiedAt = clock();
  void navigator.clipboard?.writeText(SPONSOR).catch(() => {});
};

// ================================================================ HOW-TO (layout B)

const DEF_WORD = 'planet';
const ATK_WORD = 'rocket';
function demo(t: number) {
  const tt = t % 10;
  return {
    bulletOn: tt < 4.6,
    flight: Math.min(0.85, tt / 5.4),
    defTyped: tt < 2.5 || tt >= 4.6 ? 0 : Math.min(6, Math.floor((tt - 2.5) / 0.3) + 1),
    boom: tt >= 4.6 && tt < 5.4 ? (tt - 4.6) / 0.8 : -1,
    atkTyped: tt < 5.6 || tt >= 7.4 ? 0 : Math.min(6, Math.floor((tt - 5.6) / 0.3) + 1),
    shotOn: tt >= 7.4 && tt < 9.2,
    shotFlight: (tt - 7.4) / 1.8,
    hit: tt >= 9.2 ? (tt - 9.2) / 0.8 : -1,
  };
}
function word(c: number, r: number, w: string, n: number, rest: PaletteColor = 'fg', typed: PaletteColor = 'green') {
  put(c, r, w.slice(0, n), typed);
  put(c + n, r, w.slice(n), rest);
}
function prompt(c: number, r: number, typed: string, t: number, color: PaletteColor = 'green') {
  put(c, r, '>', 'dim');
  put(c + 2, r, typed, color);
  if (blink(t)) put(c + 2 + typed.length, r, '_', 'fg');
}
function miniScene(c0: number, r0: number, k: 'defend' | 'attack', t: number) {
  const d = demo(t);
  const w = 56;
  box(c0, r0, w, 27, 'dim');
  put(c0 + 3, r0, k === 'defend' ? ' DEFEND ' : ' ATTACK ', k === 'defend' ? 'yellow' : 'red');
  const cx = c0 + w / 2;
  put(cx - 1, r0 + 3, '<@>', k === 'attack' && d.hit >= 0 && blink(t, 6) ? 'green' : 'fg');
  put(cx - 3, r0 + 15, '[ YOU ]', 'fg');
  if (k === 'defend') {
    if (d.bulletOn) {
      const y = r0 + 5 + d.flight * 9;
      word(cx - 3, y, DEF_WORD, d.defTyped, 'fg');
      put(cx, y + 1, 'v', 'dim');
    }
    if (d.boom >= 0) {
      put(cx - 4, r0 + 12, '* * * * *', 'yellow');
      put(cx - 4, r0 + 17, 'DESTROYED', 'green');
    }
    prompt(cx - 6, r0 + 19, DEF_WORD.slice(0, d.defTyped), t, 'green');
    put(c0 + 4, r0 + 22, 'TYPE THE WORD FLYING AT YOU', 'fg');
    put(c0 + 4, r0 + 23, 'THEN PRESS ENTER', 'dim');
  } else {
    word(cx - 3, r0 + 13, ATK_WORD, d.atkTyped, 'red', 'fg');
    if (d.shotOn) put(cx, r0 + 13 - d.shotFlight * 9, '^', 'yellow');
    if (d.hit >= 0 && d.hit < 0.7) put(cx + 3, r0 + 3, 'HIT!', 'green');
    prompt(cx - 6, r0 + 19, ATK_WORD.slice(0, d.atkTyped), t, 'fg');
    put(c0 + 4, r0 + 22, 'TYPE YOUR RED WORD', 'fg');
    put(c0 + 4, r0 + 23, 'THEN PRESS ENTER TO FIRE', 'dim');
  }
}
const NEXT = () => (kind === 'private' ? 'YOUR INVITE LINK' : 'FINDING AN OPPONENT');

function drawHowto(t: number) {
  twoTone(1, 'HOW TO ', 'PLAY', 3.2);
  miniScene(6, 6, 'defend', t);
  miniScene(66, 6, 'attack', t);
  const left = Math.max(0, AUTO_SECONDS - t);
  const secs = Math.ceil(left);
  const w = 60;
  const c0 = (COLS - w) / 2;
  box(c0, 34, w, 5, blink(t, 1.5) ? 'yellow' : 'fg');
  const label = '[ENTER]  START NOW';
  text.writeScaled((COLS - [...label].length * 1.5) / 2, 35.1, label, 1.5, 'yellow');
  centered(37.2, `NEXT: ${NEXT()}`, 'dim');
  const msg = `AUTO-START IN ${secs}S`;
  text.writeScaled((COLS - [...msg].length * 1.4) / 2, 39.6, msg, 1.4, secs <= 5 && blink(t, 3) ? 'yellow' : 'fg');
  const n = Math.round((left / AUTO_SECONDS) * (w - 2));
  put(c0, 42, `[${'#'.repeat(n)}${'-'.repeat(w - 2 - n)}]`, secs <= 5 ? 'yellow' : 'dim');
  if (left <= 0 && !trans) go('waiting', kind);
}

// ================================================================ WAITING (layout C3)

const TIPS = [
  "TYPE A WORD BULLET'S WORD TO DESTROY IT BEFORE IT HITS YOU",
  'TYPE YOUR ATTACK WORD AND PRESS ENTER TO FIRE AT YOUR OPPONENT',
  'DEFENDING COMES FIRST: A MATCHING WORD BULLET IS DESTROYED BEFORE YOUR ATTACK FIRES',
  'YOU HAVE 3 LIVES. EVERY WORD BULLET THAT REACHES YOU COSTS ONE',
  'IF BOTH PLAYERS STAY IDLE FOR 10 SECONDS, THE MATCH ENDS IN PEACE',
];
const mmClock = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const dots = (t: number) => '.'.repeat(1 + (Math.floor(t * 2) % 3)).padEnd(3);

function logLine(i: number): [string, string, PaletteColor] {
  const priv = kind === 'private';
  const base: [string, string, PaletteColor][] = priv
    ? [
        ['OPENING CHANNEL', 'OK', 'green'],
        ['LANGUAGE', langName(), 'fg'],
        ['CREATING PRIVATE MATCH', 'OK', 'green'],
        ['INVITE LINK', 'READY', 'green'],
        ['WAITING FOR GUEST', 'NO ONE YET', 'yellow'],
      ]
    : [
        ['OPENING CHANNEL', 'OK', 'green'],
        ['LANGUAGE', langName(), 'fg'],
        ['ENTERING QUEUE', 'OK', 'green'],
        ['SCANNING SECTOR 07', 'NO CONTACT', 'yellow'],
      ];
  if (i < base.length) return base[i];
  const k = i - base.length;
  return [priv ? `PINGING GUEST SLOT ${k + 1}` : `SCANNING SECTOR ${String(7 + (((k + 1) * 5) % 40)).padStart(2, '0')}`, 'NO CONTACT', 'yellow'];
}
function drawLog(c0: number, row: number, width: number, count: number, t: number) {
  const shown = Math.floor(t / 0.85) + 1;
  const n = Math.min(shown, count);
  const statusCol = c0 + width - 12;
  for (let k = 0; k < n; k++) {
    const i = shown > count ? shown - count + k : k;
    const [label, status, color] = logLine(i);
    put(c0, row + k, `> ${label} ${'.'.repeat(Math.max(2, statusCol - c0 - label.length - 4))}`, 'fg');
    put(statusCol, row + k, status, color);
  }
  if (blink(t)) put(c0, row + n, '> _', 'fg');
}
function signalBar(c0: number, row: number, len: number, t: number) {
  const sig = 0.18 + 0.2 * (0.5 + 0.5 * Math.sin(t * 1.3)) + 0.1 * hash(Math.floor(t * 6));
  const n = Math.round(sig * len);
  put(c0, row, `SIGNAL [${'#'.repeat(n)}${'-'.repeat(len - n)}]`, 'dim');
}
function invitePanel(row: number, t: number) {
  const w = 62;
  const c0 = Math.round((COLS - w) / 2);
  box(c0, row, w, 5, 'fg');
  put(c0 + 3, row + 1, 'INVITE LINK', 'dim');
  put(c0 + 3, row + 2, LINK, 'yellow');
  const copied = clock() - copiedAt < 1.6;
  put(c0 + w - 20, row + 3, copied ? 'COPIED!' : '[C] COPY LINK', copied ? 'green' : 'fg');
  void t;
}

function drawWaiting(t: number) {
  const p = kind === 'private';
  const [a, b] = p ? (['WAITING FOR ', 'YOUR FRIEND'] as const) : (['FINDING A ', 'RANDOM OPPONENT'] as const);
  const ticker = (row: number, dir: number) => {
    const unit = `${p ? 'WAITING FOR YOUR FRIEND' : 'FINDING A RANDOM OPPONENT'}   ///   `;
    const strip = unit.repeat(Math.ceil(COLS / unit.length) + 2);
    const shift = Math.floor(t * 10 * dir);
    put(0, row, strip.slice(((shift % unit.length) + unit.length) % unit.length).slice(0, COLS), 'yellow');
  };
  ticker(1, 1);
  ticker(43, -1);
  box(14, 5, 100, 9, 'fg');
  twoTone(7, a, b, 2.6);
  centered(11.5, p ? 'SEND THEM THE LINK BELOW. THE MATCH STARTS WHEN THEY JOIN.' : 'THE MATCH STARTS AS SOON AS ANOTHER PLAYER IS LOOKING TOO.', 'dim');
  const tip = TIPS[Math.floor(t / 6) % TIPS.length];
  put(14, 17, 'TIP', 'yellow');
  put(18, 17, tip.slice(0, Math.floor((t % 6) * 22)) + (blink(t) ? '_' : ' '), 'fg');
  const o = online();
  put(14, 20, 'ONLINE NOW', 'dim');
  put(26, 20, `${o.total}     ENGLISH ${o.en}   SPANISH ${o.es}`, 'fg');
  drawLog(14, 23, 100, p ? 3 : 10, t);
  if (p) invitePanel(29, t);
  else signalBar(14, 35, 60, t);
  centered(p ? 36 : 38, `ELAPSED ${mmClock(t)}`, 'fg');
  centered(p ? 38 : 40, `LANGUAGE: ${langName()}        [Q] CANCEL`, 'dim');
  void dots;
}

// ================================================================ keys + bar

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (k === '[' || k === ']') return cycleFx(k === ']' ? 1 : -1);
  if (trans) {
    if (k === 'Tab') e.preventDefault();
    return; // input is locked while the screen changes
  }
  if (k === '\\') return setResting(!resting);
  if (k === 'r' || k === 'R') {
    const s = screen;
    return void (trans = { phase: 'out', t: 0, to: s, toKind: kind, fx: EFFECTS[fxIndex] }, (SCREEN_TRANSITION.mode = EFFECTS[fxIndex].mode));
  }
  if (screen === 'menu') {
    if (k === 'Tab') {
      e.preventDefault();
      lang = lang === 'EN' ? 'ES' : 'EN';
    } else if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'l' || k === 'j') moveSel(1);
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'h' || k === 'k') moveSel(-1);
    else if (k === 'Enter') confirmMenu(sel);
    else if (k === '1' || k === '2' || k === '3') {
      const i = Number(k) - 1;
      if (!disabled(i)) sel = i;
      confirmMenu(i);
    } else if (k === 's' || k === 'S') copySponsor();
  } else if (screen === 'howto') {
    if (k === 'Enter') go('waiting', kind);
  } else if (screen === 'waiting') {
    if (k === 'q' || k === 'Q') go('menu', kind);
    else if ((k === 'c' || k === 'C') && kind === 'private') {
      copiedAt = clock();
      void navigator.clipboard?.writeText(LINK).catch(() => {});
    } else if (k === 'f' || k === 'F') say('OPPONENT FOUND -> Countdown (next prototype)');
  }
});

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
const restBtn = mk('', () => setResting(!resting));
bar.append(mk('←', () => cycleFx(-1)), label, mk('→', () => cycleFx(1)), mk('replay (R)', () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }))), restBtn);
document.body.append(bar);

function refreshBar() {
  label.textContent = `effect ${fxIndex + 1}: ${EFFECTS[fxIndex].name}  [ ]`;
  restBtn.textContent = `menu servers: ${resting ? 'RESTING' : 'normal'} (\\)`;
  const p = new URLSearchParams(location.search);
  p.set('fx', String(fxIndex + 1));
  history.replaceState(null, '', `?${p}`);
}
function cycleFx(d: number) {
  fxIndex = (fxIndex + d + EFFECTS.length) % EFFECTS.length;
  refreshBar();
}
function setResting(v: boolean) {
  resting = v;
  if (disabled(sel)) sel = 0;
  refreshBar();
}
refreshBar();
