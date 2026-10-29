// PROTOTYPE (throwaway): "Prototype: Rematch menu".
// Question: what should the Rematch UX on the end screen look like (proposer's view, the opponent's accept / deny
// menu, Declined, Opponent left, the 10 s window running out, the Private variant that always offers Rematch)?
// It lives in the 80-wide strip left under the win / lose banner. Layout chosen: the "edge bar". The opponent is simulated.
//
// Rules (from the map): a Rematch can be proposed for 10 s after a Match ends (Public). The opponent gets an accept /
// deny menu. Both propose -> it starts right away. Declined -> the proposer sees "Declined" and is back at the end-screen
// options. Opponent left -> "Opponent left". After the 10 s only "search new match" is left. Private: Rematch is always
// there until one player leaves (no timer).
// Round 2: once a request exists (you proposed, or they did) the 10 s window bar disappears and the other side gets a
// fixed response time, always the full time even if the window has run out (T switches 5 / 10 s). No answer = it expires.
//
// Keys:  P Public / Private      W win / lose      T response time 5 / 10 s      R reset the end screen
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
const DECLINED_SHOW = 2.4; // how long "DECLINED" / "NO ANSWER" shows before the options come back
let respond = 5; // seconds the other side has to answer a request (T switches 5 / 10)
const STARTING_SHOW = 1.0; // "REMATCH!" before the glitch into the Countdown
const params = new URLSearchParams(location.search);

type Kind = 'public' | 'private';
type View = 'idle' | 'waiting' | 'incoming' | 'declined' | 'expired' | 'left' | 'closed' | 'starting';
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

const s = {
  iProposed: false,
  iProposedAt: 0,
  theyProposed: false,
  theyProposedAt: 0,
  deniedByMe: false,
  spent: false,
  declinedAt: -1,
  expiredAt: -1,
  expiredText: 'NO ANSWER',
  left: false,
  startingAt: -1,
  closedLogged: false,
};
const log: { t: number; msg: string }[] = [];
const say = (msg: string) => (toast = { msg, at: clock() });
const note = (msg: string) => log.push({ t: now(), msg });

function reset() {
  Object.assign(s, { iProposed: false, iProposedAt: 0, theyProposed: false, theyProposedAt: 0, deniedByMe: false, spent: false, declinedAt: -1, expiredAt: -1, left: false, startingAt: -1, closedLogged: false });
  log.length = 0;
  endStart = clock();
  sel = 0;
  screen = 'end';
  note(kind === 'public' ? `MATCH OVER. REMATCH OPEN ${WINDOW} S` : 'MATCH OVER. REMATCH OPEN');
}

const windowLeft = (t: number) => (kind === 'public' ? Math.max(0, WINDOW - t) : Number.POSITIVE_INFINITY);

/** A request that nobody answered in time expires. The response time is the full `respond` whatever the window says. */
function tickRematch(t: number) {
  if (s.startingAt >= 0 || s.left) return;
  if (s.iProposed && t >= s.iProposedAt + respond) {
    s.iProposed = false;
    s.expiredAt = t;
    s.expiredText = 'NO ANSWER';
    note('NO ANSWER');
  }
  if (s.theyProposed && !s.iProposed && !s.deniedByMe && t >= s.theyProposedAt + respond) {
    s.theyProposed = false;
    s.expiredAt = t;
    s.expiredText = 'TOO LATE';
    note('REQUEST EXPIRED');
  }
}

function currentView(t: number): View {
  if (s.startingAt >= 0) return 'starting';
  if (s.left) return 'left';
  if (s.declinedAt >= 0 && t - s.declinedAt < DECLINED_SHOW) return 'declined';
  if (s.expiredAt >= 0 && t - s.expiredAt < DECLINED_SHOW) return 'expired';
  if (s.theyProposed && !s.iProposed && !s.deniedByMe) return 'incoming';
  if (s.iProposed) return 'waiting';
  return windowLeft(t) > 0 ? 'idle' : 'closed';
}

function start() {
  const t = now();
  s.startingAt = t;
  note('REMATCH STARTING');
  setTimeout(() => glitchTo('countdown'), STARTING_SHOW * 1000);
}
function propose() {
  s.iProposed = true;
  s.iProposedAt = now();
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
  s.theyProposedAt = t;
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
  if (v === 'declined' || v === 'expired') v = windowLeft(now()) > 0 ? 'idle' : 'closed';
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
  expired: { text: 'NO ANSWER', color: 'dim' },
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

  tickRematch(t);
  const v = currentView(t);
  if (windowLeft(t) <= 0 && !s.closedLogged) {
    s.closedLogged = true;
    note('REMATCH WINDOW CLOSED');
  }
  const opts = options(v);
  if (sel >= opts.length) sel = Math.max(0, opts.length - 1);
  const answerLeft = v === 'waiting' ? s.iProposedAt + respond - t : v === 'incoming' ? s.theyProposedAt + respond - t : null;
  const vm: VM = { t, v, opts, left: windowLeft(t), timed: kind === 'public' && v !== 'starting', answerLeft };
  layoutEdge(vm);
  put(2, 43, `PROTOTYPE  ${kind.toUpperCase()}  ${win ? 'WIN' : 'LOSE'}  ANSWER TIME ${respond} S   P kind  W result  T answer time  R reset   opponent: A propose  S accept  D deny  F leave`, 'dim');
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
  /** Seconds left to answer a pending request (waiting / incoming); null otherwise. */
  answerLeft: number | null;
}

const dots = (t: number) => '.'.repeat(1 + (Math.floor(t * 2.5) % 3));
const statusText = (vm: VM) => (vm.v === 'expired' ? s.expiredText : STATUS[vm.v].text + (vm.v === 'waiting' ? dots(vm.t) : ''));
const statusColor = (vm: VM): PaletteColor => (vm.v === 'incoming' && !blink(vm.t, 3) ? 'fg' : STATUS[vm.v].color);
const timerFrac = (vm: VM) => (Number.isFinite(vm.left) ? vm.left / WINDOW : 1);
const timerColor = (vm: VM): PaletteColor => (vm.left <= 3 ? 'red' : 'yellow');
const secs = (vm: VM) => `${Math.ceil(vm.left)} S`;
const optColor = (on: boolean, t: number): PaletteColor => (on ? (blink(t, 3) ? 'yellow' : 'fg') : 'dim');
const optText = (label: string, on: boolean) => (on ? `> ${label} <` : `  ${label}  `);

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
  if (vm.timed && vm.v === 'idle') {
    // The 10 s window to propose.
    const filled = Math.round(w * clamp01(timerFrac(vm)));
    put(c0, r0 + 8, '='.repeat(filled), timerColor(vm));
    put(c0 + filled, r0 + 8, '.'.repeat(w - filled), 'dim');
    put(c0 + w + 1, r0 + 8, secs(vm), timerColor(vm));
  } else if (vm.answerLeft !== null) {
    // A request exists: the window bar is gone, and a separate answer time runs (the full time, always).
    const frac = clamp01(vm.answerLeft / respond);
    const filled = Math.round(w * frac);
    const col: PaletteColor = vm.answerLeft <= 1.5 ? 'red' : 'green';
    put(c0, r0 + 8, '-'.repeat(filled), col);
    put(c0 + filled, r0 + 8, ' '.repeat(w - filled), 'dim');
    put(c0 + w + 1, r0 + 8, `${Math.ceil(Math.max(0, vm.answerLeft))} S`, col);
    put(c0, r0 + 9, vm.v === 'incoming' ? 'TIME TO ANSWER' : 'TIME FOR THEM TO ANSWER', 'dim');
  }
}

// ---------------------------------------------------------------- keys

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || trans) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k === 't') {
    respond = respond === 5 ? 10 : 5;
    return say(`ANSWER TIME ${respond} S`);
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
