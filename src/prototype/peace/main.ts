// PROTOTYPE (throwaway): "Prototype: Peace animation and screen".
// Question: what should Peace look like when both players stay Idle over 10 s: both ships fly away, the Attack
// label and the Attack word both read PEACE!! (the word in white), then a Peace end screen with the Match stats
// and room for the Rematch menu (its own ticket)? Tone: calm, nobody won, nobody lost.
//
// Four structurally different variants (A..D). The in-scene part is the same; the screen differs.
//   [ and ]  switch variant      R  replay      ?t=2.5 freezes the scene at that second
import '../../app/app.css';
import { AppShell } from '../../app/AppShell';
import type { GameSession, SessionStatus } from '../../app/GameSession';
import { KeyboardTypingInput } from '../../input/KeyboardTypingInput';
import type { TextGrid } from '../../render/AsciiRenderer';
import { SCREEN_TRANSITION } from '../../render/ScreenFilters';
import { GLITCH, ScreenTransition, TV_OFF_ON, type TransitionEffect } from '../../screens/ScreenTransition';
import { COLS, blink, box, centered, formatClock, put, twoTone } from '../../screens/draw';
import { AsciiGameView } from '../../view/AsciiGameView';
import { ENEMY_LOOK } from '../../view/enemy/EnemyShip';
import type { GameViewState, ViewEvent } from '../../view/GameViewState';

type Variant = 'A' | 'B' | 'C' | 'D';
const VARIANTS: { key: Variant; name: string }[] = [
  { key: 'A', name: 'Quiet banner' },
  { key: 'B', name: 'Two ships into the sunset' },
  { key: 'C', name: 'Ceasefire log' },
  { key: 'D', name: 'Ripples' },
];
const params = new URLSearchParams(location.search);
let variant: Variant = (VARIANTS.find((v) => v.key === params.get('variant'))?.key ?? 'A') as Variant;
const frozenAt = params.get('t') !== null ? Number(params.get('t')) : null;

/** Placeholder Match numbers. */
const STATS = { time: 71, pace: 2.9, accuracy: 0.88, words: 11, shotsFired: 3, shotsHit: 1 };

const view = await AsciiGameView.create();
const cockpit = (view as unknown as { cockpit: { attackLabel: string; attackLabelColor: 'dim' | 'fg'; attackWordWhite: boolean } }).cockpit;
const REST = { x: ENEMY_LOOK.position.x, y: ENEMY_LOOK.position.y, z: ENEMY_LOOK.position.z };

// ---------------------------------------------------------------- the scripted scene

const PEACE_AT = 0.6; // both Idle > 10 s: the Match ends in Peace
const LEAVE_FROM = 1.4; // the ships start to go
const SCENE_END = 5.2;

class PeaceSession implements GameSession {
  status: SessionStatus = 'running';
  t = 0;
  private pending: ViewEvent[] = [];
  private sent = false;
  readonly transition = new ScreenTransition();
  phase: 'scene' | 'screen' = 'scene';
  screenT = 0;

  start() {}
  dispose() {}
  attachInput() {}

  reset() {
    this.t = 0;
    this.sent = false;
    this.pending = [];
    this.phase = 'scene';
    this.screenT = 0;
    Object.assign(ENEMY_LOOK.position, REST);
    cockpit.attackLabel = 'ATTACK';
    cockpit.attackLabelColor = 'dim';
    cockpit.attackWordWhite = false;
    SCREEN_TRANSITION.level = 0;
    view.setScreen(null);
    view.setOverlay(null);
  }

  update(dt: number): ViewEvent[] {
    if (frozenAt !== null) {
      this.t = frozenAt;
      dt = 0;
    } else this.t += dt;
    this.screenT += dt;
    if (this.phase === 'scene') {
      if (this.t >= PEACE_AT && !this.sent) {
        this.sent = true;
        this.pending.push({ type: 'peace' });
        cockpit.attackLabel = 'PEACE!!';
        cockpit.attackLabelColor = 'fg';
        cockpit.attackWordWhite = true;
      }
      // The Enemy ship flies away: up, to the side, and far into the distance.
      const k = Math.min(1, Math.max(0, (this.t - LEAVE_FROM) / 3));
      const e = k * k;
      ENEMY_LOOK.position.x = REST.x + e * 30;
      ENEMY_LOOK.position.y = REST.y + e * 12;
      ENEMY_LOOK.position.z = REST.z - e * 70;
    }
    this.transition.update(dt);
    SCREEN_TRANSITION.mode = this.transition.mode;
    SCREEN_TRANSITION.level = this.transition.level;
    if (this.phase === 'scene' && this.t >= SCENE_END && !this.transition.active) this.leaveScene();
    const ev = this.pending;
    this.pending = [];
    return ev;
  }

  state(): GameViewState {
    const peace = this.t >= PEACE_AT;
    // Typing the whole Attack word turns it white: the same trick, with the word already "typed".
    const pace = this.t > LEAVE_FROM ? Math.min(9, 2 + (this.t - LEAVE_FROM) * 3) : 2;
    return {
      lives: 3,
      typedWord: '',
      attackWord: peace ? 'PEACE!!' : 'rocket',
      wordBullets: [],
      shots: [],
      enemyDamage: 0.4,
      pace: { player: pace, enemy: pace },
    };
  }

  private leaveScene() {
    const effect: TransitionEffect = variant === 'B' ? TV_OFF_ON : GLITCH;
    this.transition.start(effect, variant === 'B' ? 0.5 : 0, () => {
      this.phase = 'screen';
      this.screenT = 0;
      view.setScreen((text) => ({ A: drawA, B: drawB, C: drawC, D: drawD })[variant](text, this.screenT));
    });
  }
}

const session = new PeaceSession();
const input = new KeyboardTypingInput();
input.setEnabled(false);
new AppShell(view, session, input).start();

// ---------------------------------------------------------------- shared pieces

function statsLines() {
  return [
    ['TIME', formatClock(STATS.time)],
    ['PACE', `${STATS.pace.toFixed(1)} LETTERS/S (${Math.round((STATS.pace * 60) / 5)} WPM)`],
    ['ACCURACY', `${Math.round(STATS.accuracy * 100)}%`],
    ['WORDS DESTROYED', String(STATS.words)],
    ['SHOTS HIT', `${STATS.shotsHit} OF ${STATS.shotsFired}`],
  ] as const;
}

function statsBlock(text: TextGrid, row: number, color: 'fg' | 'dim' = 'fg') {
  const lines = statsLines().map(([k, v]) => `${k.padEnd(18)}${v}`);
  const col = (COLS - Math.max(...lines.map((l) => l.length))) / 2;
  lines.forEach((l, i) => put(text, col, row + i, l, color));
}

function rematchSlot(text: TextGrid, row: number) {
  box(text, 24, row, 80, 5, 'dim');
  put(text, 27, row, ' REMATCH MENU GOES HERE (OWN TICKET) ', 'dim');
  centered(text, row + 2, '[R] PROPOSE A REMATCH     [S] SEARCH FOR A NEW OPPONENT     [Q] MENU', 'dim');
}

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// ---------------------------------------------------------------- A: quiet banner (all white, no color)

function drawA(text: TextGrid, t: number) {
  const a = Math.min(1, t / 1.5);
  if (a > 0.2) text.writeScaled((COLS - 'PEACE'.length * 8) / 2, 3.5, 'PEACE', 8, 'fg');
  centered(text, 15, 'NOBODY WON. NOBODY LOST.', 'fg');

  // Why it ended this way, as a gentle note (not an order). "RED WORD" is red, like the Attack word in the Cockpit.
  const parts: [string, 'dim' | 'red'][] = [
    ['BOTH SHIPS WENT QUIET AND FLEW AWAY, BECAUSE NEITHER PILOT CHOSE TO ATTACK WITH THE ', 'dim'],
    ['RED WORD', 'red'],
  ];
  let col = (COLS - parts.reduce((n, [s]) => n + s.length, 0)) / 2;
  parts.forEach(([s, c]) => {
    put(text, col, 17, s, c);
    col += s.length;
  });

  statsBlock(text, 21);

  // A well-known line about peace (Albert Einstein); the quote is still to be chosen with the user.
  if (t > 1.4) {
    centered(text, 29, '"PEACE CANNOT BE KEPT BY FORCE;', 'dim');
    centered(text, 30.4, 'IT CAN ONLY BE ACHIEVED BY UNDERSTANDING."', 'dim');
    centered(text, 32, '- ALBERT EINSTEIN', 'dim');
  }
  if (t > 1) rematchSlot(text, 36);
}

// ---------------------------------------------------------------- B: two ships fly into the sunset

const SHIP = ['   /\\', '  /  \\', ' / /\\ \\', '/_/  \\_\\'];

function drawB(text: TextGrid, t: number) {
  // a sun and a horizon
  const sunRow = 18 + Math.min(6, t * 1.2);
  [[-8, 0, '.:::::.'], [-9, 1, ':#######:'], [-9, 2, ':#######:'], [-8, 3, "'::::'"]].forEach(([dx, dy, s]) => put(text, 64 + (dx as number), sunRow + (dy as number), s as string, 'yellow'));
  put(text, 0, 29, '-'.repeat(COLS), 'dim');
  for (let i = 0; i < 40; i++) put(text, Math.floor(hash(i) * COLS), 31 + Math.floor(hash(i * 3) * 8), hash(i * 7) > 0.5 ? '~' : '-', 'dim');
  // two ships, one from each side, drifting toward the sun and shrinking
  const k = Math.min(1, t / 6);
  SHIP.forEach((l, i) => {
    put(text, 8 + k * 46, 24 - k * 4 + i * (1 - k * 0.5), l, 'fg');
    put(text, 112 - k * 52, 22 - k * 3 + i * (1 - k * 0.5), l, 'fg');
  });
  twoTone(text, 2, 'PEACE', '', 4);
  centered(text, 9, 'BOTH SHIPS FLEW AWAY, NOBODY WON', 'dim');
  statsBlock(text, 32, 'fg');
  rematchSlot(text, 38);
}

// ---------------------------------------------------------------- C: ceasefire log

function drawC(text: TextGrid, t: number) {
  twoTone(text, 2, 'CEASE', 'FIRE', 3.4);
  box(text, 22, 9, 84, 22, 'fg');
  put(text, 25, 9, ' TREATY ', 'fg');
  const log: [string, string][] = [
    ['PILOT A: NO ORDERS FOR 10 S', 'AGREED'],
    ['PILOT B: NO ORDERS FOR 10 S', 'AGREED'],
    ['HOSTILITIES', 'SUSPENDED'],
    ['BOTH SHIPS', 'STANDING DOWN'],
    ['RESULT', 'PEACE'],
  ];
  const shown = Math.floor(t / 0.55) + 1;
  log.forEach(([k, v], i) => {
    if (i >= shown) return;
    put(text, 25, 11 + i * 2, `> ${k} ${'.'.repeat(60 - k.length)}`, 'fg');
    put(text, 25 + 64, 11 + i * 2, v, i === log.length - 1 ? 'fg' : 'green');
  });
  if (shown > log.length) statsBlock(text, 22.5, 'fg');
  rematchSlot(text, 34);
}

// ---------------------------------------------------------------- D: slow ripples, lots of air

function drawD(text: TextGrid, t: number) {
  const cx = COLS / 2;
  const cy = 22;
  for (let k = 0; k < 5; k++) {
    const rad = ((t * 3 + k * 5) % 25) + 1;
    for (let d = 0; d < 360; d += 2) {
      const a = (d * Math.PI) / 180;
      const c = Math.round(cx + Math.cos(a) * rad * 1.6);
      const r = Math.round(cy - Math.sin(a) * rad * 0.9);
      if (c >= 0 && c < COLS && r >= 0 && r < 44) put(text, c, r, rad > 16 ? '.' : ':', 'dim');
    }
  }
  box(text, 34, 12, 60, 20, 'fg');
  text.writeScaled((COLS - 'PEACE'.length * 3.4) / 2, 13.5, 'PEACE', 3.4, 'fg');
  centered(text, 19, 'THE SKY IS QUIET', 'dim');
  statsBlock(text, 22);
  if (blink(t, 0.5)) centered(text, 29.5, '~  ~  ~', 'dim');
  rematchSlot(text, 36);
}

// ---------------------------------------------------------------- keys + bar (prototype-only)

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
bar.append(mk('←', () => cycle(-1)), label, mk('→', () => cycle(1)), mk('replay (R)', () => session.reset()));
document.body.append(bar);

function refreshBar() {
  const v = VARIANTS.find((x) => x.key === variant)!;
  label.textContent = `${v.key} (${v.name})  [ ]`;
  const p = new URLSearchParams(location.search);
  p.set('variant', variant);
  history.replaceState(null, '', `?${p}`);
}
function cycle(d: number) {
  const i = VARIANTS.findIndex((v) => v.key === variant);
  variant = VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length].key;
  session.reset();
  refreshBar();
}
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '[' || e.key === ']') cycle(e.key === ']' ? 1 : -1);
  else if (e.key === 'r' || e.key === 'R') session.reset();
});
refreshBar();
