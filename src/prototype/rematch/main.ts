// PROTOTYPE (throwaway): "Prototype: Rematch menu".
// Question: what should the Rematch UX on the end screen look like (proposer's view, the opponent's accept / deny
// menu, Declined, Opponent left, the 10 s window running out, the Private variant that always offers Rematch)?
// It lives in the 80-wide strip left under the win / lose banner. Four layouts to compare. The opponent is simulated.
//
// Rules (from the map): a Rematch can be proposed for 10 s after a Match ends (Public). The opponent gets an accept /
// deny menu. Both propose -> it starts right away. Declined -> the proposer sees "Declined" and is back at the end-screen
// options. Opponent left -> "Opponent left". After the 10 s only "search new match" is left. Private: Rematch is always
// there until one player leaves (no timer).
//
// Keys:  1-4 layout      P Public / Private      W win / lose      R reset the end screen
//   You:  hjkl or arrows + Enter
//   The simulated opponent:  A proposes a Rematch   S accepts your proposal   D denies it   F leaves
import * as THREE from 'three';
import '../../app/app.css';
import { AppShell } from '../../app/AppShell';
import type { GameSession, SessionStatus } from '../../app/GameSession';
import { KeyboardTypingInput } from '../../input/KeyboardTypingInput';
import type { PaletteColor, TextGrid } from '../../render/AsciiRenderer';
import type { GpuAsciiRenderer } from '../../render/GpuAsciiRenderer';
import { SCREEN_TRANSITION } from '../../render/ScreenFilters';
import { AsciiGameView } from '../../view/AsciiGameView';
import type { GameViewState, ViewEvent } from '../../view/GameViewState';

const COLS = 128;
const WINDOW = 10; // seconds the Rematch can be proposed (Public)
const DECLINED_SHOW = 2.4; // how long "DECLINED" shows before the options come back
const STARTING_SHOW = 1.0; // "REMATCH!" before the glitch into the Countdown
const params = new URLSearchParams(location.search);

type Kind = 'public' | 'private';
type View = 'idle' | 'waiting' | 'incoming' | 'declined' | 'left' | 'closed' | 'starting';
const LAYOUTS = ['Framed list', 'Big buttons', 'Channel log', 'Edge bar'];
let layout = Math.min(3, Math.max(0, Number(params.get('layout') ?? 1) - 1));
let kind: Kind = params.get('kind') === 'private' ? 'private' : 'public';
let win = params.get('result') !== 'lose';
let sel = 0;
let screen: 'end' | 'countdown' = 'end';
let toast: { msg: string; at: number } | null = null;

const t0 = performance.now();
const clock = () => (performance.now() - t0) / 1000;
const freezeT = params.get('t') !== null ? Number(params.get('t')) : null; // ?t=3 freezes the end-screen clock for stills
let endStart = clock();
const now = () => freezeT ?? clock() - endStart;

// ---------------------------------------------------------------- the Rematch state (simulated opponent)

const s = { iProposed: false, theyProposed: false, deniedByMe: false, spent: false, declinedAt: -1, left: false, startingAt: -1, closedLogged: false };
const log: { t: number; msg: string }[] = [];
const say = (msg: string) => (toast = { msg, at: clock() });
const note = (msg: string) => log.push({ t: now(), msg });

function reset() {
  Object.assign(s, { iProposed: false, theyProposed: false, deniedByMe: false, spent: false, declinedAt: -1, left: false, startingAt: -1, closedLogged: false });
  log.length = 0;
  endStart = clock();
  sel = 0;
  screen = 'end';
  note(kind === 'public' ? `MATCH OVER. REMATCH OPEN ${WINDOW} S` : 'MATCH OVER. REMATCH OPEN');
}

const windowLeft = (t: number) => (kind === 'public' ? Math.max(0, WINDOW - t) : Number.POSITIVE_INFINITY);

function currentView(t: number): View {
  if (s.startingAt >= 0) return 'starting';
  if (s.left) return 'left';
  const open = windowLeft(t) > 0;
  if (s.declinedAt >= 0 && t - s.declinedAt < DECLINED_SHOW) return 'declined';
  if (s.theyProposed && !s.iProposed && !s.deniedByMe && open) return 'incoming';
  if (s.iProposed && open) return 'waiting';
  return open ? 'idle' : 'closed';
}

function start() {
  const t = now();
  s.startingAt = t;
  note('REMATCH STARTING');
  setTimeout(() => glitchTo('countdown'), STARTING_SHOW * 1000);
}
function propose() {
  s.iProposed = true;
  note('YOU: REMATCH?');
  if (s.theyProposed) start();
}
function cancel() {
  s.iProposed = false;
  note('YOU: CANCELLED');
}
function accept() {
  note('YOU: ACCEPTED');
  start();
}
function deny() {
  s.deniedByMe = true;
  s.theyProposed = false;
  if (kind === 'public') s.spent = true;
  note('YOU: DENIED');
}
function theyPropose() {
  const t = now();
  if (s.left || s.startingAt >= 0 || windowLeft(t) <= 0) return say('NOT POSSIBLE NOW');
  s.theyProposed = true;
  note('ENEMY: REMATCH?');
  if (s.iProposed) start();
}
function theyAccept() {
  if (!s.iProposed || s.left || s.startingAt >= 0) return say('YOU HAVE NOT PROPOSED');
  note('ENEMY: ACCEPTED');
  start();
}
function theyDeny() {
  if (!s.iProposed || s.left || s.startingAt >= 0) return say('YOU HAVE NOT PROPOSED');
  s.iProposed = false;
  s.declinedAt = now();
  if (kind === 'public') s.spent = true;
  note('ENEMY: DENIED');
}
function theyLeave() {
  if (s.startingAt >= 0) return;
  s.left = true;
  note('ENEMY LEFT');
}

// ---------------------------------------------------------------- the options per view

type Opt = { id: 'rematch' | 'search' | 'menu' | 'accept' | 'deny' | 'cancel'; label: string };
function options(v: View): Opt[] {
  const search: Opt = { id: 'search', label: 'SEARCH NEW MATCH' };
  const menu: Opt = { id: 'menu', label: 'MENU' };
  if (v === 'incoming') return [{ id: 'accept', label: 'ACCEPT' }, { id: 'deny', label: 'DENY' }];
  if (v === 'waiting') return [{ id: 'cancel', label: 'CANCEL' }];
  if (v === 'starting') return [];
  if (v === 'left' || v === 'closed') return kind === 'public' ? [search, menu] : [menu];
  const rematch: Opt[] = s.spent && kind === 'public' ? [] : [{ id: 'rematch', label: 'REMATCH' }];
  return kind === 'public' ? [...rematch, search, menu] : [...rematch, menu];
}

function choose(o: Opt) {
  if (o.id === 'rematch') propose();
  else if (o.id === 'accept') accept();
  else if (o.id === 'deny') deny();
  else if (o.id === 'cancel') cancel();
  else say(`${o.label}: not part of this prototype`);
}

const STATUS: Record<View, { text: string; color: PaletteColor }> = {
  idle: { text: '', color: 'dim' },
  waiting: { text: 'WAITING FOR OPPONENT', color: 'yellow' },
  incoming: { text: 'OPPONENT WANTS A REMATCH', color: 'yellow' },
  declined: { text: 'DECLINED', color: 'red' },
  left: { text: 'OPPONENT LEFT', color: 'red' },
  closed: { text: 'REMATCH CLOSED', color: 'dim' },
  starting: { text: 'REMATCH!', color: 'green' },
};

// ---------------------------------------------------------------- stub session + renderer hook

class ProtoSession implements GameSession {
  status: SessionStatus = 'running';
  start() {}
  dispose() {}
  attachInput() {}
  update(): ViewEvent[] {
    return [];
  }
  state(): GameViewState {
    return { lives: 3, typedWord: '', attackWord: '', wordBullets: [], shots: [], enemyDamage: 0, pace: { player: 1, enemy: 1 } };
  }
}
const session = new ProtoSession();
const input = new KeyboardTypingInput();
input.setEnabled(false);
const view = await AsciiGameView.create();
const hidden = view as unknown as { ascii: GpuAsciiRenderer; scene: THREE.Scene; overlay: THREE.Scene };
const text: TextGrid = hidden.ascii.textGrid;
const asciiRender = hidden.ascii.render.bind(hidden.ascii);

/** The shared glitch (0.3 s) from the end screen into the Countdown. */
let trans: { phase: 'out' | 'in'; t: number; to: 'end' | 'countdown' } | null = null;
function glitchTo(to: 'end' | 'countdown') {
  if (trans) return;
  trans = { phase: 'out', t: 0, to };
  SCREEN_TRANSITION.mode = 4;
}
function tickTransition(dt: number) {
  if (!trans) {
    SCREEN_TRANSITION.level = 0;
    return;
  }
  trans.t += dt;
  const u = Math.min(1, trans.t / (trans.phase === 'out' ? 0.13 : 0.17));
  if (trans.phase === 'out') {
    SCREEN_TRANSITION.level = u * u;
    if (u >= 1) {
      screen = trans.to;
      trans = { ...trans, phase: 'in', t: 0 };
    }
  } else {
    SCREEN_TRANSITION.level = (1 - u) * (1 - u);
    if (u >= 1) trans = null;
  }
}

let lastFrame = performance.now();
hidden.ascii.render = (scene, camera, overlay) => {
  const ms = performance.now();
  tickTransition(Math.min((ms - lastFrame) / 1000, 0.1));
  lastFrame = ms;
  hidden.scene.visible = false;
  hidden.overlay.visible = false;
  text.clear();
  if (screen === 'end') drawEnd(now());
  else drawCountdownStub();
  if (toast && clock() - toast.at < 2.4) centered(0.3, toast.msg, 'green');
  asciiRender(scene, camera, overlay);
};
new AppShell(view, session, input).start();

// ---------------------------------------------------------------- helpers

const put = (c: number, r: number, str: string, col?: PaletteColor) => text.write(Math.round(c), Math.round(r), str, col);
const centered = (r: number, str: string, col?: PaletteColor) => put((COLS - [...str].length) / 2, r, str, col);
const blink = (t: number, hz = 2) => Math.floor(t * hz) % 2 === 0;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
function box(c0: number, r0: number, w: number, h: number, color: PaletteColor = 'dim') {
  text.fill(c0, r0, w, h, ' ');
  put(c0, r0, '+' + '-'.repeat(w - 2) + '+', color);
  put(c0, r0 + h - 1, '+' + '-'.repeat(w - 2) + '+', color);
  for (let r = r0 + 1; r < r0 + h - 1; r++) {
    put(c0, r, '|', color);
    put(c0 + w - 1, r, '|', color);
  }
}
function bar(c0: number, row: number, w: number, frac: number, color: PaletteColor) {
  const n = Math.round(w * clamp01(frac));
  put(c0, row, '[' + '#'.repeat(n) + '-'.repeat(w - n) + ']', color);
}

// ---------------------------------------------------------------- the end screen (win / lose placeholder + the strip)

const STRIP = { c0: 24, r0: 32, w: 80 };

function drawEnd(t: number) {
  // placeholder for the win / lose screen (its own tickets)
  const a = 'YOU ';
  const b = win ? 'WIN' : 'LOSE';
  const scale = 7;
  const c = (COLS - ([...a].length + [...b].length) * scale) / 2;
  text.writeScaled(c, 3.5, a, scale, 'fg');
  text.writeScaled(c + [...a].length * scale, 3.5, b, scale, win ? 'yellow' : 'red');
  centered(15, win ? 'THE ENEMY SHIP IS DESTROYED' : 'YOUR SHIP IS DESTROYED', win ? 'green' : 'red');
  centered(21, '[ MATCH STATS GO HERE ]', 'dim');

  const v = currentView(t);
  if (windowLeft(t) <= 0 && !s.closedLogged) {
    s.closedLogged = true;
    note('REMATCH WINDOW CLOSED');
  }
  const opts = options(v);
  if (sel >= opts.length) sel = Math.max(0, opts.length - 1);
  const vm: VM = { t, v, opts, left: windowLeft(t), timed: kind === 'public' && v !== 'starting' };
  [layoutList, layoutButtons, layoutLog, layoutEdge][layout](vm);
  put(2, 43, `PROTOTYPE  LAYOUT ${layout + 1}: ${LAYOUTS[layout]}  ${kind.toUpperCase()}  ${win ? 'WIN' : 'LOSE'}   1-4 layout  P kind  W result  R reset   opponent: A propose  S accept  D deny  F leave`, 'dim');
}

function drawCountdownStub() {
  centered(18, 'COUNTDOWN (STUB)', 'yellow');
  centered(21, 'THE REMATCH STARTS HERE: SAME SEEDS, THE WORD INDEX CONTINUES', 'dim');
  centered(24, '[ R ] BACK TO THE END SCREEN', 'dim');
}

interface VM {
  t: number;
  v: View;
  opts: Opt[];
  /** Seconds left of the Rematch window (Infinity in Private). */
  left: number;
  /** Whether a window timer is shown. */
  timed: boolean;
}

const dots = (t: number) => '.'.repeat(1 + (Math.floor(t * 2.5) % 3));
const statusText = (vm: VM) => STATUS[vm.v].text + (vm.v === 'waiting' ? dots(vm.t) : '');
const statusColor = (vm: VM): PaletteColor => (vm.v === 'incoming' && !blink(vm.t, 3) ? 'fg' : STATUS[vm.v].color);
const timerFrac = (vm: VM) => (Number.isFinite(vm.left) ? vm.left / WINDOW : 1);
const timerColor = (vm: VM): PaletteColor => (vm.left <= 3 ? 'red' : 'yellow');
const secs = (vm: VM) => `${Math.ceil(vm.left)} S`;
const optColor = (on: boolean, t: number): PaletteColor => (on ? (blink(t, 3) ? 'yellow' : 'fg') : 'dim');
const optText = (label: string, on: boolean) => (on ? `> ${label} <` : `  ${label}  `);

/** 1: a framed list, like the Opponent left screen. */
function layoutList(vm: VM) {
  const { c0, r0, w } = STRIP;
  box(c0, r0, w, 9, vm.v === 'incoming' ? (blink(vm.t, 3) ? 'yellow' : 'dim') : 'dim');
  put(c0 + 3, r0, ' REMATCH ', 'yellow');
  if (vm.timed && vm.v !== 'closed' && vm.v !== 'left') put(c0 + w - 10, r0, ` ${secs(vm)} `, timerColor(vm));
  const st = statusText(vm);
  if (st) put(c0 + 5, r0 + 2, st, statusColor(vm));
  vm.opts.forEach((o, i) => {
    const row = r0 + 4 + i;
    put(c0 + 5, row, optText(o.label, i === sel), optColor(i === sel, vm.t));
    if (o.id === 'rematch' && vm.timed && vm.v === 'idle') bar(c0 + 34, row, 24, timerFrac(vm), timerColor(vm));
  });
  put(c0 + w - 32, r0 + 7, 'ARROWS OR HJKL   ENTER', 'dim');
}

/** 2: one big button per choice; the Rematch button carries its own timer bar. */
function layoutButtons(vm: VM) {
  const { r0 } = STRIP;
  const st = statusText(vm);
  if (st) text.writeScaled((COLS - [...st].length * 1.4) / 2, r0, st, 1.4, statusColor(vm));
  const n = Math.max(1, vm.opts.length);
  const bw = 24;
  const gap = 3;
  const total = n * bw + (n - 1) * gap;
  const x0 = (COLS - total) / 2;
  vm.opts.forEach((o, i) => {
    const x = x0 + i * (bw + gap);
    const on = i === sel;
    box(x, r0 + 3, bw, 6, on ? (blink(vm.t, 3) ? 'yellow' : 'fg') : 'dim');
    const label = o.label.length > bw - 4 ? o.label.replace('SEARCH NEW MATCH', 'NEW MATCH') : o.label;
    put(x + (bw - [...label].length) / 2, r0 + 5, label, on ? 'fg' : 'dim');
    if (o.id === 'rematch' && vm.timed && vm.v === 'idle') {
      bar(x + 2, r0 + 7, bw - 4, timerFrac(vm), timerColor(vm));
    }
  });
  if (vm.timed && vm.v === 'idle' && vm.opts.some((o) => o.id === 'rematch')) centered(r0 + 10, `REMATCH OPEN ${secs(vm)}`, timerColor(vm));
}

/** 3: a channel log on the left (what happened), the choices on the right. */
function layoutLog(vm: VM) {
  const { c0, r0, w } = STRIP;
  box(c0, r0, w, 9, 'dim');
  const st = statusText(vm);
  put(c0 + 3, r0, ` REMATCH${st ? ': ' + st : ''} `, st ? statusColor(vm) : 'yellow');
  if (vm.timed && vm.v !== 'closed' && vm.v !== 'left') put(c0 + w - 10, r0, ` ${secs(vm)} `, timerColor(vm));
  const lines = log.slice(-6);
  lines.forEach((l, i) => put(c0 + 4, r0 + 2 + i, `[+${l.t.toFixed(1).padStart(4, '0')}] ${l.msg}`.slice(0, 40), i === lines.length - 1 ? 'fg' : 'dim'));
  for (let r = r0 + 1; r < r0 + 8; r++) put(c0 + 46, r, '|', 'dim');
  vm.opts.forEach((o, i) => put(c0 + 50, r0 + 2 + i * 2, optText(o.label, i === sel), optColor(i === sel, vm.t)));
}

/** 4: no boxes: a status line, a row of choices, and a thin bar along the edge that shrinks with the window. */
function layoutEdge(vm: VM) {
  const { c0, w, r0 } = STRIP;
  const st = statusText(vm);
  if (st) text.writeScaled((COLS - [...st].length * 1.4) / 2, r0 + 1, st, 1.4, statusColor(vm));
  const labels = vm.opts.map((o, i) => optText(o.label, i === sel));
  const widths = labels.map((l) => [...l].length);
  const gap = 6;
  const total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, labels.length - 1);
  let x = (COLS - total) / 2;
  labels.forEach((l, i) => {
    put(x, r0 + 5, l, optColor(i === sel, vm.t));
    x += widths[i] + gap;
  });
  if (vm.timed && (vm.v === 'idle' || vm.v === 'waiting' || vm.v === 'incoming')) {
    const filled = Math.round(w * clamp01(timerFrac(vm)));
    put(c0, r0 + 8, '='.repeat(filled), timerColor(vm));
    put(c0 + filled, r0 + 8, '.'.repeat(w - filled), 'dim');
    put(c0 + w + 1, r0 + 8, secs(vm), timerColor(vm));
  }
}

// ---------------------------------------------------------------- keys

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || trans) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k >= '1' && k <= '4') {
    layout = Number(k) - 1;
    return say(`LAYOUT ${layout + 1}: ${LAYOUTS[layout].toUpperCase()}`);
  }
  if (k === 'p') {
    kind = kind === 'public' ? 'private' : 'public';
    reset();
    return say(kind.toUpperCase());
  }
  if (k === 'w') {
    win = !win;
    return say(win ? 'WIN' : 'LOSE');
  }
  if (k === 'r') return screen === 'countdown' ? (reset(), glitchTo('end')) : reset();
  if (screen !== 'end') return;
  if (k === 'a') return theyPropose();
  if (k === 's') return theyAccept();
  if (k === 'd') return theyDeny();
  if (k === 'f') return theyLeave();
  const opts = options(currentView(now()));
  if (!opts.length) return;
  if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'l' || k === 'j') sel = (sel + 1) % opts.length;
  else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'h' || k === 'k') sel = (sel + opts.length - 1) % opts.length;
  else if (k === 'Enter') choose(opts[sel]);
});

reset();
