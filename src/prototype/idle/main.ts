// PROTOTYPE (throwaway): "Prototype: Idle nudge animation".
// Question: after 5 s with no keystrokes, what draws the player's attention to their Attack word? Noticeable but not
// annoying, sustainable for the 5 s that can pass before Peace (both players Idle > 10 s), and it must stop the moment
// the player types. Real renderer + CRT + the real Cockpit (a small throwaway hook recolors the Attack word).
//
// You play the real input: type the Attack word ("rocket") and press Space to fire; stop typing and the nudge starts
// at 5 s. No incoming Word bullets here, so nothing hurts you while you wait.
// Keys (non-letters, so they never reach the typing field):
//   1-4  variant        =  the opponent is Idle too (escalates, and counts down to Peace at 10 s)
//   .    jump to 4.5 s idle (so you don't have to wait)        ,  reset the idle clock
import '../../app/app.css';
import { AppShell } from '../../app/AppShell';
import type { GameSession, SessionStatus } from '../../app/GameSession';
import { KeyboardTypingInput } from '../../input/KeyboardTypingInput';
import type { TypingInput } from '../../input/TypingInput';
import type { PaletteColor, TextGrid } from '../../render/AsciiRenderer';
import type { GpuAsciiRenderer } from '../../render/GpuAsciiRenderer';
import { AsciiGameView } from '../../view/AsciiGameView';
import { ATTACK_FX } from '../../view/cockpit/Cockpit';
import type { GameViewState, ViewEvent } from '../../view/GameViewState';

const COLS = 128;
const NUDGE_AFTER = 5; // seconds without typing
const PEACE_AFTER = 10; // both Idle for this long ends the Match in Peace
const params = new URLSearchParams(location.search);

const VARIANTS = [
  { key: 'A', name: 'Blink and chevrons' },
  { key: 'B', name: 'Bobbing marker and hint' },
  { key: 'C', name: 'Scanner sweep' },
  { key: 'D', name: 'Sonar rings' },
];
let variant = Math.max(0, 'ABCD'.indexOf(params.get('v') ?? 'A'));
let bothIdle = params.get('both') === '1';
let toast: { msg: string; at: number } | null = null;
const clock0 = performance.now();
const clock = () => (performance.now() - clock0) / 1000;
const say = (msg: string) => (toast = { msg, at: clock() });

// ---------------------------------------------------------------- stub game (no opponent, no bullets)

const WORDS = ['rocket', 'meteor', 'comet', 'galaxy', 'planet', 'orbit'];

class ProtoSession implements GameSession {
  status: SessionStatus = 'running';
  t = 0;
  idleFor = params.get('idle') !== null ? Number(params.get('idle')) : 0;
  private i = 0;
  private input?: TypingInput;
  start() {}
  dispose() {}
  attachInput(input: TypingInput) {
    this.input = input;
    input.onChange(() => (this.idleFor = 0)); // any typing ends Idle
    input.onSubmit((w) => {
      this.idleFor = 0;
      if (w === WORDS[this.i % WORDS.length]) this.i++; // fired: the next Attack word
    });
  }
  update(dt: number): ViewEvent[] {
    this.t += dt;
    this.idleFor += dt;
    applyFx(this.t, this.idleFor);
    return [];
  }
  state(): GameViewState {
    return { lives: 3, typedWord: this.input?.typedWord ?? '', attackWord: WORDS[this.i % WORDS.length], wordBullets: [], shots: [], enemyDamage: 0, pace: { player: 1, enemy: 1 } };
  }
}
const session = new ProtoSession();
const input = new KeyboardTypingInput();
const view = await AsciiGameView.create();
const hidden = view as unknown as { ascii: GpuAsciiRenderer };
const text: TextGrid = hidden.ascii.textGrid;
const asciiRender = hidden.ascii.render.bind(hidden.ascii);
hidden.ascii.render = (scene, camera, overlay) => {
  text.fill(7, 1, 30, 3, ' '); // hide the game view's dim debug event label
  drawDecor(session.t, session.idleFor);
  if (toast && clock() - toast.at < 2.4) centered(0.3, toast.msg, 'green');
  put(2, 43, `PROTOTYPE  VARIANT ${VARIANTS[variant].key}: ${VARIANTS[variant].name}   OPPONENT ${bothIdle ? 'IDLE TOO' : 'ACTIVE'}   IDLE ${session.idleFor.toFixed(1)} S   keys: 1-4 variant  = opponent idle  . skip to 4.5 s  , reset   (type the Attack word to test)`, 'dim');
  asciiRender(scene, camera, overlay);
};
new AppShell(view, session, input).start();

// ---------------------------------------------------------------- helpers

const put = (c: number, r: number, s: string, col?: PaletteColor) => text.write(Math.round(c), Math.round(r), s, col);
const centered = (r: number, s: string, col?: PaletteColor) => put((COLS - [...s].length) / 2, r, s, col);
const blink = (t: number, hz = 2) => Math.floor(t * hz) % 2 === 0;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** How fast the animation runs: faster when the opponent is Idle too (Peace is coming). */
const rate = () => (bothIdle ? 1.8 : 1);
/** Seconds since the nudge started (negative before). */
const nudgeT = (idleFor: number) => idleFor - NUDGE_AFTER;

// ---------------------------------------------------------------- the effect on the Attack word (runs before the Cockpit draws)

function applyFx(t: number, idleFor: number) {
  ATTACK_FX.dx = 0;
  ATTACK_FX.dy = 0;
  ATTACK_FX.color = null;
  ATTACK_FX.colors = null;
  ATTACK_FX.labelColor = null;
  const nt = nudgeT(idleFor);
  if (nt < 0) return;
  const r = rate();
  const len = ATTACK_FX.rect.len;
  if (nt < 0.35) ATTACK_FX.color = 'yellow'; // a quick pop when the nudge starts, in every variant
  else if (variant === 0) {
    ATTACK_FX.color = blink(nt * r, 1.6) ? 'fg' : 'red';
    ATTACK_FX.labelColor = 'fg';
  } else if (variant === 1) {
    ATTACK_FX.labelColor = 'fg';
  } else if (variant === 2) {
    const pos = ((nt * r * 0.8) % 1.5) * (len + 4) - 2;
    ATTACK_FX.colors = Array.from({ length: len }, (_, i) => (Math.abs(i - pos) < 1.3 ? 'fg' : 'red'));
    ATTACK_FX.labelColor = 'fg';
  } else {
    const pulse = (nt * r * 0.7) % 1;
    ATTACK_FX.color = pulse < 0.22 ? 'yellow' : 'red';
  }
  void t;
}

// ---------------------------------------------------------------- the decoration around it (runs after the Cockpit drew)

function drawDecor(t: number, idleFor: number) {
  const nt = nudgeT(idleFor);
  const { c, row, len, scale } = ATTACK_FX.rect;
  const W = len * scale;
  const cx = c + W / 2;
  const r = rate();

  if (bothIdle && idleFor >= NUDGE_AFTER) {
    const left = Math.max(0, Math.ceil(PEACE_AFTER - idleFor));
    if (left > 0) centered(row - 10, `PEACE IN ${left}`, 'fg'); // steady white label, no blinking
    else centered(row - 10, 'PEACE!!', 'fg'); // the Peace ending starts here (its own ticket)
  }
  if (nt < 0) return;

  if (variant === 0) {
    // three chevrons light up in turn, pointing at the word
    const lit = Math.floor(nt * r * 4) % 4;
    for (let i = 0; i < 3; i++) put(c - 10 + i * 3.2, row + 0.3, '>', lit === i ? 'yellow' : 'dim');
  } else if (variant === 1) {
    // a marker bobbing above the word, a short hint, and an underline
    const bob = Math.sin(nt * r * 5) * 0.7;
    put(cx - 0.5, row - 3 + bob, 'V', 'yellow');
    if (blink(nt * r, 1.2)) put(cx - 3.5, row - 5, 'TYPE IT', 'yellow');
    put(c, row + 1.7, '^'.repeat(Math.ceil(W)), blink(nt * r, 2) ? 'yellow' : 'dim');
  } else if (variant === 2) {
    // brackets round the word and a scan line above it
    put(c - 2.2, row + 0.3, '[', 'yellow');
    put(c + W + 0.6, row + 0.3, ']', 'yellow');
    const n = Math.ceil(W) + 4;
    const at = Math.floor(((nt * r * 0.8) % 1.5) * (len + 4) * scale) - 2;
    for (let i = 0; i < n; i++) put(c - 2 + i, row - 1.3, Math.abs(i - at) <= 1 ? '#' : '-', Math.abs(i - at) <= 1 ? 'fg' : 'dim');
  } else {
    // half-rings rise from the word, like a sonar ping
    for (let k = 0; k < 3; k++) {
      const u = (((nt * r * 0.7 - k / 3) % 1) + 1) % 1;
      const col: PaletteColor = u < 0.45 ? 'yellow' : 'dim';
      for (let a = 0; a <= 40; a++) {
        const ang = Math.PI + (a / 40) * Math.PI; // the upper half
        put(cx + Math.cos(ang) * u * 38, row + 0.5 + Math.sin(ang) * u * 8, '.', col);
      }
    }
  }
  void clamp01;
}

// ---------------------------------------------------------------- keys

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key >= '1' && e.key <= '4') {
    variant = Number(e.key) - 1;
    return say(`VARIANT ${VARIANTS[variant].key}: ${VARIANTS[variant].name.toUpperCase()}`);
  }
  if (e.key === '=') {
    bothIdle = !bothIdle;
    return say(bothIdle ? 'OPPONENT IS IDLE TOO' : 'OPPONENT ACTIVE');
  }
  if (e.key === '.') session.idleFor = NUDGE_AFTER - 0.5;
  if (e.key === ',') session.idleFor = 0;
});
