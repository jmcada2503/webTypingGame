// PROTOTYPE (throwaway): "Prototype: Win animation and screen".
// Question: what should winning look like: the animation when the last hit lands, then the win screen with the
// Match stats (time, Pace, accuracy...) and room for the Rematch menu (its own ticket)?
//
// Four structurally different variants (A..D), each = an in-scene finish + its own win screen.
//   [ and ]  switch variant      R  replay      Ctrl+... not needed here
// Runs on the real renderer, the real game scene, the real glitch / TV effects. Placeholder stats.
import * as THREE from 'three';
import '../../app/app.css';
import { AppShell } from '../../app/AppShell';
import type { GameSession, SessionStatus } from '../../app/GameSession';
import { KeyboardTypingInput } from '../../input/KeyboardTypingInput';
import type { TextGrid } from '../../render/AsciiRenderer';
import { SCREEN_TRANSITION } from '../../render/ScreenFilters';
import { GLITCH, ScreenTransition, TV_OFF_ON, type TransitionEffect } from '../../screens/ScreenTransition';
import { COLS, blink, box, centered, formatClock, put, twoTone } from '../../screens/draw';
import { AsciiGameView } from '../../view/AsciiGameView';
import { SHOT_HIT_LOOK } from '../../view/juice/ShotHitFx';
import type { GameViewState, ViewEvent } from '../../view/GameViewState';

type Variant = 'A' | 'B' | 'C' | 'D';
const VARIANTS: { key: Variant; name: string }[] = [
  { key: 'A', name: 'Fireball + banner' },
  { key: 'B', name: 'Terminal debrief' },
  { key: 'C', name: 'Victory lap in the scene' },
  { key: 'D', name: 'Confetti + ship flies off' },
];
const params = new URLSearchParams(location.search);
let variant: Variant = (VARIANTS.find((v) => v.key === params.get('variant'))?.key ?? 'A') as Variant;

/** Placeholder Match numbers. */
const STATS = { time: 134, pace: 3.4, accuracy: 0.91, words: 22, shotsFired: 9, shotsHit: 3 };

const view = await AsciiGameView.create();
const hidden = view as unknown as { enemy: { root: THREE.Group }; hitFx: { shake(): void } };

// ---------------------------------------------------------------- the scripted finish

/** When things happen in the scene, in seconds. */
const SCRIPT: { t: number; do: (s: WinSession) => void }[] = [
  { t: 0.4, do: (s) => s.hit(0.4) },
  { t: 1.0, do: (s) => s.hit(0.8) },
  { t: 1.6, do: (s) => ((SHOT_HIT_LOOK.boomSize = 6), s.hit(1)) },
  { t: 1.65, do: () => hidden.hitFx.shake() },
  { t: 2.1, do: () => (hidden.enemy.root.visible = false) },
];
const SCENE_END = 3.2; // the scene part is over; the variant moves on to its screen (or stays)

class WinSession implements GameSession {
  status: SessionStatus = 'running';
  t = 0;
  damage = 0;
  pace = 2;
  private pending: ViewEvent[] = [];
  private next = 0;
  private n = 0;
  readonly transition = new ScreenTransition();
  phase: 'scene' | 'screen' = 'scene';
  screenT = 0;

  start() {}
  dispose() {}
  attachInput() {}

  hit(damage: number) {
    this.damage = damage;
    this.pending.push({ type: 'shotHit', id: `s${this.n++}` });
  }

  reset() {
    this.t = 0;
    this.damage = 0;
    this.pace = 2;
    this.next = 0;
    this.phase = 'scene';
    this.screenT = 0;
    this.pending = [];
    SHOT_HIT_LOOK.boomSize = 3;
    hidden.enemy.root.visible = true;
    SCREEN_TRANSITION.level = 0;
    view.setScreen(null);
    view.setOverlay(null);
  }

  update(dt: number): ViewEvent[] {
    this.t += dt;
    this.screenT += dt;
    while (this.next < SCRIPT.length && this.t >= SCRIPT[this.next].t) SCRIPT[this.next++].do(this);
    if (variant === 'C' && this.t > 2.1) this.pace = Math.min(9, this.pace + dt * 6); // the stars race past
    this.transition.update(dt);
    SCREEN_TRANSITION.mode = this.transition.mode;
    SCREEN_TRANSITION.level = this.transition.level;
    if (this.phase === 'scene' && this.t >= SCENE_END && !this.transition.active) this.leaveScene();
    const ev = this.pending;
    this.pending = [];
    return ev;
  }

  state(): GameViewState {
    return { lives: 3, typedWord: '', attackWord: 'rocket', wordBullets: [], shots: [], enemyDamage: this.damage, pace: { player: this.pace, enemy: 0 } };
  }

  private leaveScene() {
    if (variant === 'C') {
      this.phase = 'screen';
      this.screenT = 0;
      view.setOverlay((text) => drawC(text, this.screenT));
      return;
    }
    const effect: TransitionEffect = variant === 'B' ? TV_OFF_ON : GLITCH;
    this.transition.start(effect, variant === 'B' ? 0.5 : 0, () => {
      this.phase = 'screen';
      this.screenT = 0;
      view.setScreen((text) => ({ A: drawA, B: drawB, C: () => {}, D: drawD })[variant](text, this.screenT));
    });
  }
}

const session = new WinSession();
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

/** Stats as an aligned block, centered as a whole, starting at `row`. */
function statsBlock(text: TextGrid, row: number, color: 'fg' | 'dim' = 'fg') {
  const lines = statsLines().map(([k, v]) => `${k.padEnd(18)}${v}`);
  const col = (COLS - Math.max(...lines.map((l) => l.length))) / 2;
  lines.forEach((l, i) => put(text, col, row + i, l, color));
}

/** The room left for the Rematch menu (its own ticket): a placeholder strip. */
function rematchSlot(text: TextGrid, row: number) {
  box(text, 24, row, 80, 5, 'dim');
  put(text, 27, row, ' REMATCH MENU GOES HERE (OWN TICKET) ', 'dim');
  centered(text, row + 2, '[R] PROPOSE A REMATCH     [S] SEARCH FOR A NEW OPPONENT     [Q] MENU', 'dim');
}

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// ---------------------------------------------------------------- A: fireball, then a big banner

function drawA(text: TextGrid, t: number) {
  // victory sparks rising behind the text
  for (let i = 0; i < 60; i++) {
    const x = Math.floor(hash(i * 3.1) * COLS);
    const y = 44 - ((t * (2 + hash(i) * 4) + hash(i * 7) * 44) % 44);
    put(text, x, y, hash(i * 5) > 0.7 ? '*' : '.', hash(i * 9) > 0.5 ? 'yellow' : 'green');
  }
  text.fill(0, 2, COLS, 20, ' ');
  twoTone(text, 3.5, 'YOU ', 'WIN', 7);
  centered(text, 15, 'THE ENEMY SHIP IS DESTROYED', 'green');
  statsBlock(text, 19);
  rematchSlot(text, 32);
}

// ---------------------------------------------------------------- B: terminal debrief

const DEBRIEF: [string, string, 'green' | 'yellow' | 'fg'][] = [
  ['ENEMY HULL INTEGRITY', '0%', 'fg'],
  ['ENEMY ENGINES', 'OFFLINE', 'fg'],
  ['ENEMY SHIP', 'DESTROYED', 'green'],
  ['MATCH', 'WON', 'green'],
];

function drawB(text: TextGrid, t: number) {
  twoTone(text, 2, 'MATCH ', 'WON', 3);
  box(text, 22, 8, 84, 24, 'dim');
  put(text, 25, 8, ' DEBRIEF ', 'fg');
  const shown = Math.floor(t / 0.55) + 1;
  DEBRIEF.forEach(([label, status, color], i) => {
    if (i >= shown) return;
    put(text, 25, 10 + i, `> ${label} ${'.'.repeat(60 - label.length)}`, 'fg');
    put(text, 25 + 64, 10 + i, status, color);
  });
  if (shown > DEBRIEF.length) {
    put(text, 25, 15, '> FLIGHT RECORDER', 'yellow');
    const lines = statsLines();
    lines.forEach(([k, v], i) => {
      if (shown - DEBRIEF.length - 1 > i) put(text, 29, 17 + i, `${k.padEnd(18)}${v}`, 'fg');
    });
  }
  if (blink(t)) put(text, 25, 31 - 1, '> _', 'fg');
  rematchSlot(text, 34);
}

// ---------------------------------------------------------------- C: victory lap over the live scene

function drawC(text: TextGrid, t: number) {
  const s = Math.min(1, t / 0.5);
  twoTone(text, 6.5, 'YOU ', 'WIN', 4 + s * 3);
  if (t > 0.8) {
    box(text, 36, 17, 56, 9, 'fg');
    statsBlock(text, 19, 'fg');
  }
  if (t > 1.4) centered(text, 30, '[R] REMATCH     [S] SEARCH AGAIN     [Q] MENU   (REMATCH MENU: OWN TICKET)', 'dim');
}

// ---------------------------------------------------------------- D: confetti, a ship flying off, victory art

const SHIP = ['      /\\', '     /  \\', '    / /\\ \\', ' __/ /  \\ \\__', '/___/    \\___\\', '    \\_/\\_/'];

function drawD(text: TextGrid, t: number) {
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(hash(i * 2.3) * COLS);
    const y = ((t * (3 + hash(i) * 5) + hash(i * 11) * 44) % 44);
    const g = ['*', '+', '.', 'o'][Math.floor(hash(i * 4) * 4)];
    put(text, x + Math.sin(t * 2 + i) * 2, y, g, (['green', 'yellow', 'red', 'fg'] as const)[Math.floor(hash(i * 6) * 4)]);
  }
  const shipRow = 30 - Math.min(24, t * 7);
  SHIP.forEach((l, i) => put(text, 14, shipRow + i, l, 'fg'));
  text.fill(40, 2, 80, 8, ' ');
  twoTone(text, 3, 'VICTORY', '!', 6);
  box(text, 40, 14, 60, 9, 'fg');
  statsBlock(text, 16);
  rematchSlot(text, 30);
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
