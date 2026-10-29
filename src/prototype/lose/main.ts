// PROTOTYPE (throwaway): "Prototype: Lose animation and screen".
// Question: what should losing look like: the animation when the last Life goes, then the lose screen with the
// Match stats and room for the Rematch menu (its own ticket)? Tone: a defeat, not a punishment.
//
// Four structurally different variants (A..D), each = an in-scene ending + its own lose screen.
//   [ and ]  switch variant      R  replay
// Runs on the real renderer, the real game scene and the real glitch / TV effects. Placeholder stats.
import '../../app/app.css';
import { AppShell } from '../../app/AppShell';
import type { GameSession, SessionStatus } from '../../app/GameSession';
import { KeyboardTypingInput } from '../../input/KeyboardTypingInput';
import type { TextGrid } from '../../render/AsciiRenderer';
import { SCREEN_HIT, SCREEN_TRANSITION } from '../../render/ScreenFilters';
import { GLITCH, ScreenTransition, TV_OFF_ON, type TransitionEffect } from '../../screens/ScreenTransition';
import { COLS, blink, box, centered, formatClock, put, twoTone } from '../../screens/draw';
import { AsciiGameView } from '../../view/AsciiGameView';
import type { GameViewState, ViewEvent } from '../../view/GameViewState';

type Variant = 'A' | 'B' | 'C' | 'D';
const VARIANTS: { key: Variant; name: string }[] = [
  { key: 'A', name: 'Cockpit powers down' },
  { key: 'B', name: 'Signal lost' },
  { key: 'C', name: 'Wreck drifting' },
  { key: 'D', name: 'Black box report' },
];
const params = new URLSearchParams(location.search);
let variant: Variant = (VARIANTS.find((v) => v.key === params.get('variant'))?.key ?? 'A') as Variant;

/** Placeholder Match numbers (the loser's side). */
const STATS = { time: 134, pace: 2.6, accuracy: 0.84, words: 17, shotsFired: 9, shotsHit: 1, enemyDamage: 40 };

const view = await AsciiGameView.create();

// ---------------------------------------------------------------- the scripted ending

const SCENE_END = 4.6;

class LoseSession implements GameSession {
  status: SessionStatus = 'running';
  t = 0;
  lives = 1;
  pace = 2;
  private pending: ViewEvent[] = [];
  private fired = new Set<number>();
  readonly transition = new ScreenTransition();
  phase: 'scene' | 'screen' = 'scene';
  screenT = 0;

  start() {}
  dispose() {}
  attachInput() {}

  private at(t: number, f: () => void) {
    if (this.t >= t && !this.fired.has(t)) {
      this.fired.add(t);
      f();
    }
  }

  reset() {
    this.t = 0;
    this.lives = 1;
    this.pace = 2;
    this.pending = [];
    this.fired.clear();
    this.phase = 'scene';
    this.screenT = 0;
    SCREEN_HIT.level = 0;
    SCREEN_TRANSITION.level = 0;
    view.setScreen(null);
    view.setOverlay(null);
  }

  update(dt: number): ViewEvent[] {
    this.t += dt;
    this.screenT += dt;
    if (this.phase === 'scene') {
      // A last Word bullet reaches the Cockpit at 0.8 s: the final Life goes.
      this.at(0.1, () => this.pending.push({ type: 'enemyFired', id: 'w0' }));
      this.at(0.8, () => {
        this.pending.push({ type: 'wordBulletArrived', id: 'w0' }, { type: 'lifeLost' });
        this.lives = 0;
      });
      if (variant === 'A' && this.t > 1.2) this.pace = Math.max(0, this.pace - dt * 2); // the stars slow to a stop
      if (variant === 'C' && this.t > 1.2) this.pace = Math.max(0.3, this.pace - dt * 1.5);
    }
    this.transition.update(dt);
    SCREEN_TRANSITION.mode = this.transition.mode;
    SCREEN_TRANSITION.level = this.transition.level;
    // A: the lights dim slowly after the last Life goes.
    if (variant === 'A' && this.phase === 'scene' && this.t > 1.4) SCREEN_HIT.level = Math.max(SCREEN_HIT.level, Math.min(0.85, (this.t - 1.4) * 0.45));
    if (this.phase === 'scene' && this.t >= SCENE_END && !this.transition.active) this.leaveScene();
    const ev = this.pending;
    this.pending = [];
    return ev;
  }

  state(): GameViewState {
    return { lives: this.lives, typedWord: '', attackWord: 'rocket', wordBullets: [], shots: [], enemyDamage: 0.4, pace: { player: this.pace, enemy: 3 } };
  }

  private leaveScene() {
    const effect: TransitionEffect = variant === 'A' || variant === 'B' ? TV_OFF_ON : GLITCH;
    this.transition.start(effect, variant === 'A' ? 1 : variant === 'B' ? 0.4 : 0, () => {
      this.phase = 'screen';
      this.screenT = 0;
      SCREEN_HIT.level = 0;
      view.setScreen((text) => ({ A: drawA, B: drawB, C: drawC, D: drawD })[variant](text, this.screenT));
    });
  }
}

const session = new LoseSession();
const input = new KeyboardTypingInput();
input.setEnabled(false);
new AppShell(view, session, input).start();

// ---------------------------------------------------------------- shared pieces

function statsLines() {
  return [
    ['TIME SURVIVED', formatClock(STATS.time)],
    ['PACE', `${STATS.pace.toFixed(1)} LETTERS/S (${Math.round((STATS.pace * 60) / 5)} WPM)`],
    ['ACCURACY', `${Math.round(STATS.accuracy * 100)}%`],
    ['WORDS DESTROYED', String(STATS.words)],
    ['SHOTS HIT', `${STATS.shotsHit} OF ${STATS.shotsFired}`],
    ['ENEMY DAMAGE', `${STATS.enemyDamage}%`],
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

// ---------------------------------------------------------------- A: the cockpit powers down, a sober screen

function drawA(text: TextGrid, t: number) {
  twoTone(text, 3.5, 'YOU ', 'LOSE', 7);
  centered(text, 15, 'YOUR SHIP WAS DESTROYED', 'red');
  statsBlock(text, 19);
  // a cold flicker line, like a dying monitor
  if (hash(Math.floor(t * 9)) > 0.55) put(text, 20 + hash(Math.floor(t * 9) + 1) * 80, 17, '_'.repeat(8), 'dim');
  if (t > 1) rematchSlot(text, 32);
}

// ---------------------------------------------------------------- B: signal lost, static and a status log

function drawB(text: TextGrid, t: number) {
  for (let i = 0; i < 160; i++) {
    const x = Math.floor(hash(i * 3.7 + Math.floor(t * 10)) * COLS);
    const y = Math.floor(hash(i * 5.3 + Math.floor(t * 10) * 2) * 44);
    if (y < 10 || y > 29 || x < 18 || x > 110) put(text, x, y, ['.', ':', '-'][i % 3], 'dim');
  }
  twoTone(text, 2, 'SIGNAL ', 'LOST', 3.4);
  box(text, 22, 9, 84, 22, 'red');
  put(text, 25, 9, ' LAST TRANSMISSION ', 'red');
  const log = [
    ['HULL INTEGRITY', '0%'],
    ['LIVES', '0 OF 3'],
    ['ENGINES', 'OFFLINE'],
    ['RADAR', 'OFFLINE'],
    ['LINK TO PILOT', 'LOST'],
  ];
  const shown = Math.floor(t / 0.5) + 1;
  log.forEach(([k, v], i) => {
    if (i < shown) {
      put(text, 25, 11 + i * 2, `> ${k} ${'.'.repeat(64 - k.length)}`, 'fg');
      put(text, 25 + 68, 11 + i * 2, v, 'red');
    }
  });
  if (shown > log.length) statsBlock(text, 22, 'fg');
  rematchSlot(text, 35);
}

// ---------------------------------------------------------------- C: the wreck drifts, calm

function drawC(text: TextGrid, t: number) {
  for (let i = 0; i < 70; i++) {
    const drift = (t * (0.6 + hash(i) * 1.4)) % COLS;
    const x = (Math.floor(hash(i * 2.1) * COLS) - drift + COLS) % COLS;
    put(text, x, Math.floor(hash(i * 4.7) * 44), hash(i * 3) > 0.8 ? '+' : '.', 'dim');
  }
  const x = 8 + Math.sin(t * 0.6) * 3 + t * 0.3;
  const y = 18 + Math.sin(t * 0.9) * 1.2;
  const WRECK = ['     _/\\_', '   _/ /\\ \\_', ' _/  /  \\  \\_', '/___/    \\___ ', '   \\  ..  /', '    \\_/\\_/'];
  WRECK.forEach((l, i) => put(text, x, y + i, l, 'dim'));
  [[-2, 2], [3, -1], [8, 3], [-5, 0]].forEach(([dx, dy], i) => put(text, x + 6 + dx + Math.sin(t + i) * 2, y + 3 + dy + Math.cos(t * 0.7 + i), ['*', '.', ':', '+'][i], 'dim'));
  text.writeScaled((COLS - 'DEFEATED'.length * 5) / 2, 3, 'DEFEATED', 5, 'fg');
  centered(text, 11, 'THE ENEMY WINS THIS ONE', 'dim');
  box(text, 40, 16, 64, 10, 'dim');
  statsBlock(text, 18, 'fg');
  rematchSlot(text, 31);
}

// ---------------------------------------------------------------- D: black box report, a cold document

function drawD(text: TextGrid, t: number) {
  box(text, 12, 2, 104, 40, 'fg');
  twoTone(text, 4, 'BLACK BOX ', 'REPORT', 2.4);
  put(text, 16, 9, 'FLIGHT .......... 00417          RESULT .......... DEFEAT', 'dim');
  put(text, 16, 10, 'CAUSE OF LOSS ... ALL LIVES LOST TO ENEMY WORD BULLETS', 'dim');
  put(text, 16, 12, '-'.repeat(96), 'dim');
  const lines = statsLines();
  const shown = Math.floor(t / 0.35);
  lines.forEach(([k, v], i) => {
    if (shown > i) {
      put(text, 18, 14 + i * 2, `${k.padEnd(20)}${v}`, 'fg');
      put(text, 82, 14 + i * 2, '#'.repeat(Math.round((i === 2 ? STATS.accuracy : 0.3 + i * 0.1) * 20)), 'green');
    }
  });
  if (shown > lines.length) put(text, 18, 27, blink(t) ? 'PILOT STATUS: GROUNDED_' : 'PILOT STATUS: GROUNDED ', 'red');
  put(text, 16, 29, '-'.repeat(96), 'dim');
  rematchSlot(text, 34);
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
