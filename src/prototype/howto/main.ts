// PROTOTYPE (throwaway): "Prototype: How-to screen".
// Question: one screen, tiny texts + arrows, how to DEFEND (type the word of a word flying at you)
// and how to ATTACK (type your red word); Q skips. Extremely short.
//
// Four structurally different layouts, all driven by the same 10 s looping demo
// (a word flies in -> it gets typed -> destroyed; then the red word is typed -> fired -> hit).
//   [ and ]  switch layout     M  Public / Private (only changes the "next" label)
//   Enter = start now (the only button); the screen also auto-starts after 30 s. No Q.
// Real renderer + CRT filter; layout D uses the real game scene. No networking, no game logic.
import * as THREE from 'three';
import '../../app/app.css';
import { AppShell } from '../../app/AppShell';
import type { GameSession, SessionStatus } from '../../app/GameSession';
import { KeyboardTypingInput } from '../../input/KeyboardTypingInput';
import type { PaletteColor, TextGrid } from '../../render/AsciiRenderer';
import type { GpuAsciiRenderer } from '../../render/GpuAsciiRenderer';
import { AsciiGameView } from '../../view/AsciiGameView';
import type { GameViewState, ViewEvent } from '../../view/GameViewState';

type Variant = 'A' | 'B' | 'C' | 'D';
const VARIANTS: { key: Variant; name: string }[] = [
  { key: 'A', name: 'Diagram with arrows' },
  { key: 'B', name: 'Two mini demos' },
  { key: 'C', name: 'Three steps' },
  { key: 'D', name: 'Real scene + callouts' },
];
const COLS = 128;
const AUTO_SECONDS = 30;
const DEF_WORD = 'planet';
const ATK_WORD = 'rocket';

const params = new URLSearchParams(location.search);
let variant: Variant = (VARIANTS.find((v) => v.key === params.get('variant'))?.key ?? 'B') as Variant;
let priv = params.get('mode') === 'private';
const t0 = performance.now();
let screenStart = 0;
let toast: { msg: string; at: number } | null = null;
const now = () => (performance.now() - t0) / 1000;

// ---------------------------------------------------------------- the looping demo

/** What is happening t seconds into the 10 s demo. */
function demo(t: number) {
  const tt = t % 10;
  const cyc = Math.floor(t / 10);
  const defTyped = tt < 2.5 || tt >= 4.6 ? 0 : Math.min(6, Math.floor((tt - 2.5) / 0.3) + 1);
  const atkTyped = tt < 5.6 || tt >= 7.4 ? 0 : Math.min(6, Math.floor((tt - 5.6) / 0.3) + 1);
  return {
    tt,
    cyc,
    bulletOn: tt < 4.6,
    flight: Math.min(0.85, tt / 5.4),
    defTyped,
    boom: tt >= 4.6 && tt < 5.4 ? (tt - 4.6) / 0.8 : -1,
    atkTyped,
    shotOn: tt >= 7.4 && tt < 9.2,
    shotFlight: (tt - 7.4) / 1.8,
    hit: tt >= 9.2 ? (tt - 9.2) / 0.8 : -1,
    /** 1 = defend, 2 = attack, 0 = idle: which half of the demo is running. */
    phase: tt < 5.4 ? 1 : 2,
  };
}

/** Feeds the real game scene (layout D) from the same demo. */
class DemoSession implements GameSession {
  status: SessionStatus = 'running';
  time = 0;
  start() {}
  dispose() {}
  attachInput() {}
  update(dt: number): ViewEvent[] {
    const prev = this.time % 10;
    this.time += dt;
    const cur = this.time % 10;
    const cyc = Math.floor(this.time / 10);
    const ev: ViewEvent[] = [];
    if (cur >= prev) {
      const cross = (x: number) => prev < x && cur >= x;
      if (cross(4.6)) ev.push({ type: 'wordBulletDestroyed', id: `b${cyc}` });
      if (cross(7.4)) ev.push({ type: 'attackFired', id: `s${cyc}`, word: ATK_WORD });
      if (cross(9.2)) ev.push({ type: 'shotHit', id: `s${cyc}` });
    }
    return ev;
  }
  state(): GameViewState {
    const d = demo(this.time);
    return {
      lives: 3,
      typedWord: d.defTyped ? DEF_WORD.slice(0, d.defTyped) : d.atkTyped ? ATK_WORD.slice(0, d.atkTyped) : '',
      attackWord: ATK_WORD,
      wordBullets: d.bulletOn ? [{ id: `b${d.cyc}`, word: DEF_WORD, flight: d.flight }] : [],
      shots: d.shotOn ? [{ id: `s${d.cyc}`, word: ATK_WORD, flight: d.shotFlight }] : [],
      enemyDamage: 0,
      pace: { player: 2, enemy: 2 },
    };
  }
}

const session = new DemoSession();
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

const put = (c: number, r: number, s: string, col?: PaletteColor) => text.write(Math.round(c), Math.round(r), s, col);
const centered = (r: number, s: string, col?: PaletteColor) => put((COLS - [...s].length) / 2, r, s, col);
const blink = (t: number, hz = 2) => Math.floor(t * hz) % 2 === 0;
const NEXT = () => (priv ? 'YOUR INVITE LINK' : 'FINDING AN OPPONENT');

function box(c0: number, r0: number, w: number, h: number, color: PaletteColor = 'dim') {
  text.fill(c0, r0, w, h, ' ');
  put(c0, r0, '+' + '-'.repeat(w - 2) + '+', color);
  put(c0, r0 + h - 1, '+' + '-'.repeat(w - 2) + '+', color);
  for (let r = r0 + 1; r < r0 + h - 1; r++) {
    put(c0, r, '|', color);
    put(c0 + w - 1, r, '|', color);
  }
}

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

function title(row: number) {
  const a = 'HOW TO ';
  const b = 'PLAY';
  const scale = 3.2;
  const c = (COLS - ([...a].length + [...b].length) * scale) / 2;
  text.writeScaled(c, row, a, scale, 'fg');
  text.writeScaled(c + [...a].length * scale, row, b, scale, 'yellow');
}

/** A word with its first `n` letters typed (green) and the rest in `rest` color. */
function word(c: number, r: number, w: string, n: number, rest: PaletteColor = 'fg') {
  put(c, r, w.slice(0, n), 'green');
  put(c + n, r, w.slice(n), rest);
}

/** The prompt line showing what is being typed: `> planet_` (blinking cursor). */
function prompt(c: number, r: number, typed: string, t: number, color: PaletteColor = 'green') {
  put(c, r, '>', 'dim');
  put(c + 2, r, typed, color);
  if (blink(t)) put(c + 2 + typed.length, r, '_', 'fg');
}

function drawFooter(t: number, top = false) {
  const left = Math.max(0, AUTO_SECONDS - (now() - screenStart));
  const secs = Math.ceil(left);
  if (left <= 0) {
    say(`AUTO-START -> ${NEXT()}`);
    screenStart = now();
  }
  if (top) {
    text.fill(20, 0, 88, 4, ' ');
    centered(1.4, `[ENTER] START NOW      AUTO-START IN ${secs}S`, blink(t, 1.5) ? 'yellow' : 'fg');
    centered(2.7, `NEXT: ${NEXT()}`, 'dim');
  } else {
    // The Enter "button": a framed, blinking box. Under it, a big countdown and a draining bar.
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
  }
  if (toast && now() - toast.at < 2.4) centered(top ? 41 : 33, toast.msg, 'green');
}

// ---------------------------------------------------------------- A: diagram with arrows

function drawA(t: number) {
  const d = demo(t);
  title(1);
  // Enemy ship at the top, you at the bottom, a lane down on the left and a lane up on the right.
  put(55, 5, 'ENEMY SHIP', 'dim');
  put(61, 6, '<@>', 'fg');
  const L = 44;
  const R = 84;
  put(L + 1, 7, '.'.repeat(16), 'dim');
  put(L - 15, 7, '', 'dim');
  for (let r = 8; r <= 28; r++) put(L, r, ':', 'dim');
  put(L, 29, 'v', 'fg');
  put(L + 1, 30, '.'.repeat(8), 'dim');
  put(L + 9, 30, '>', 'fg');
  for (let r = 8; r <= 28; r++) put(R, r, ':', 'dim');
  put(R, 7, '^', 'fg');
  put(R - 16, 7, '.'.repeat(16), 'dim');
  put(R - 8, 30, '.'.repeat(8), 'dim');
  put(R - 9, 30, '', 'dim');
  // You
  box(54, 30, 20, 5, 'fg');
  put(56, 30, ' YOU ', 'fg');
  put(64 - 3, 32, ATK_WORD, 'red');
  if (d.atkTyped) word(64 - 3, 32, ATK_WORD, d.atkTyped, 'red');
  put(60, 31, 'ATTACK', 'dim');
  // moving word in the left lane
  if (d.bulletOn) {
    const y = 8 + d.flight * 21;
    word(L - 3, y, DEF_WORD, d.defTyped, 'fg');
  }
  if (d.boom >= 0) {
    put(L - 3, 26, '* * * *', 'yellow');
    put(L - 5, 27, 'DESTROYED', 'green');
  }
  // fired shot in the right lane
  if (d.shotOn) put(R, 29 - d.shotFlight * 21, '*', 'yellow');
  if (d.hit >= 0 && d.hit < 0.7 && blink(t, 6)) put(R - 5, 6, 'HIT!', 'green');
  // captions
  text.writeScaled(4, 11, 'DEFEND', 1.5, 'yellow');
  wrap('WORDS FLY AT YOU FROM THE ENEMY SHIP. TYPE ONE AND PRESS ENTER TO DESTROY IT.', 28).forEach((l, i) => put(4, 14.5 + i, l, 'fg'));
  text.writeScaled(96, 11, 'ATTACK', 1.5, 'red');
  wrap('TYPE YOUR RED WORD AND PRESS ENTER TO FIRE AT THE ENEMY SHIP.', 28).forEach((l, i) => put(96, 14.5 + i, l, 'fg'));
  prompt(54, 37, d.defTyped ? DEF_WORD.slice(0, d.defTyped) : ATK_WORD.slice(0, d.atkTyped), t, d.phase === 1 ? 'green' : 'fg');
  drawFooter(t);
}

// ---------------------------------------------------------------- B: two mini demos

function miniScene(c0: number, r0: number, kind: 'defend' | 'attack', t: number) {
  const d = demo(t);
  const w = 56;
  box(c0, r0, w, 27, 'dim');
  put(c0 + 3, r0, kind === 'defend' ? ' DEFEND ' : ' ATTACK ', kind === 'defend' ? 'yellow' : 'red');
  const cx = c0 + w / 2;
  put(cx - 1, r0 + 3, '<@>', kind === 'attack' && d.hit >= 0 && blink(t, 6) ? 'green' : 'fg');
  put(cx - 3, r0 + 15, '[ YOU ]', 'fg');
  if (kind === 'defend') {
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
    word(cx - 3, r0 + 13, ATK_WORD, d.atkTyped, 'red');
    if (d.shotOn) put(cx, r0 + 13 - d.shotFlight * 9, '^', 'yellow');
    if (d.hit >= 0 && d.hit < 0.7) put(cx + 3, r0 + 3, 'HIT!', 'green');
    prompt(cx - 6, r0 + 19, ATK_WORD.slice(0, d.atkTyped), t, 'fg');
    put(c0 + 4, r0 + 22, 'TYPE YOUR RED WORD', 'fg');
    put(c0 + 4, r0 + 23, 'THEN PRESS ENTER TO FIRE', 'dim');
  }
}

function drawB(t: number) {
  title(1);
  miniScene(6, 6, 'defend', t);
  miniScene(66, 6, 'attack', t);
  drawFooter(t);
}

// ---------------------------------------------------------------- C: three steps

function drawC(t: number) {
  const d = demo(t);
  title(1);
  const cards = [
    { n: '1', head: 'WORDS FLY AT YOU', body: 'THE ENEMY SHIP FIRES WORDS AT YOU.', active: d.tt < 2.5 },
    { n: '2', head: 'DEFEND', body: 'TYPE A WORD AND PRESS ENTER TO DESTROY IT.', active: d.tt >= 2.5 && d.tt < 5.4 },
    { n: '3', head: 'ATTACK', body: 'TYPE YOUR RED WORD AND PRESS ENTER TO FIRE BACK.', active: d.tt >= 5.4 },
  ];
  cards.forEach((c, i) => {
    const c0 = 6 + i * 41;
    box(c0, 8, 34, 24, c.active ? (blink(t, 3) ? 'yellow' : 'fg') : 'dim');
    text.writeScaled(c0 + 3, 9.5, c.n, 2.2, 'yellow');
    text.writeScaled(c0 + 8, 10.2, c.head, 1.3, 'fg');
    wrap(c.body, 28).forEach((l, k) => put(c0 + 3, 26 + k, l, 'fg'));
    if (i < 2) put(c0 + 35, 20, '--->', 'fg');
  });
  // card 1 visual
  put(21 - 1, 14, '<@>', 'fg');
  const y = 15 + Math.min(1, d.tt / 4.6) * 8;
  if (d.bulletOn) {
    put(17, y, DEF_WORD, 'fg');
    put(21, y + 1, 'v', 'dim');
  }
  put(17, 24, '[ YOU ]', 'fg');
  // card 2 visual
  put(47 + 3, 15, DEF_WORD, 'fg');
  word(47 + 3, 15, DEF_WORD, d.defTyped, 'fg');
  prompt(47 + 3, 19, DEF_WORD.slice(0, d.defTyped), t, 'green');
  if (d.defTyped === 6) put(47 + 20, 19, '[ENTER]', blink(t, 4) ? 'yellow' : 'fg');
  if (d.boom >= 0) put(47 + 3, 22, '* * * *  DESTROYED', 'green');
  // card 3 visual
  word(88 + 3, 15, ATK_WORD, d.atkTyped, 'red');
  prompt(88 + 3, 19, ATK_WORD.slice(0, d.atkTyped), t, 'fg');
  if (d.atkTyped === 6) put(88 + 20, 19, '[ENTER]', blink(t, 4) ? 'yellow' : 'fg');
  if (d.shotOn) put(88 + 8, 22 - d.shotFlight * 3, '^ ^ ^', 'yellow');
  if (d.hit >= 0 && d.hit < 0.7) put(88 + 3, 22, 'HIT!', 'green');
  drawFooter(t);
}

// ---------------------------------------------------------------- D: real scene + callouts

function drawD(t: number) {
  const d = demo(t);
  const pulse = blink(t, 3);
  // callouts over the live game scene
  box(4, 12, 42, 7, d.phase === 1 ? 'yellow' : 'dim');
  put(7, 12, ' DEFEND ', 'yellow');
  wrap('TYPE A WORD FLYING AT YOU, THEN PRESS ENTER TO DESTROY IT.', 36).forEach((l, i) => put(7, 14 + i, l, 'fg'));
  put(47, 15, pulse ? '-->' : '   ', 'yellow');
  box(82, 12, 42, 7, d.phase === 2 ? 'red' : 'dim');
  put(85, 12, ' ATTACK ', 'red');
  wrap('TYPE YOUR RED WORD AT THE BOTTOM, THEN PRESS ENTER TO FIRE AT THE ENEMY.', 36).forEach((l, i) => put(85, 14 + i, l, 'fg'));
  put(78, 15, pulse ? '<--' : '   ', 'red');
  const arrow = pulse ? 'v v v' : '     ';
  put(82, 20, arrow, 'red');
  text.fill(0, 1, 26, 3, ' '); // hides the game view's dim debug event label
  drawFooter(t, true);
}

function drawVariant() {
  const t = now();
  const world = variant === 'D';
  hidden.scene.visible = world;
  hidden.overlay.visible = world;
  if (!world) text.clear();
  ({ A: drawA, B: drawB, C: drawC, D: drawD })[variant](t);
}

// ---------------------------------------------------------------- keys + switcher bar (prototype-only)

const say = (msg: string) => (toast = { msg, at: now() });
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (k === '[' || k === ']') return cycle(k === ']' ? 1 : -1);
  if (k === 'm' || k === 'M') return setPriv(!priv);
  if (k === 'Enter') say(`START -> ${NEXT()}`);
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
const modeBtn = mk('', () => setPriv(!priv));
bar.append(mk('←', () => cycle(-1)), label, mk('→', () => cycle(1)), modeBtn);
document.body.append(bar);

function refreshBar() {
  const v = VARIANTS.find((x) => x.key === variant)!;
  label.textContent = `${v.key} (${v.name})  [ ]`;
  modeBtn.textContent = `next: ${priv ? 'private' : 'public'} (M)`;
  const p = new URLSearchParams(location.search);
  p.set('variant', variant);
  p.set('mode', priv ? 'private' : 'public');
  history.replaceState(null, '', `?${p}`);
}
function cycle(d: number) {
  const i = VARIANTS.findIndex((v) => v.key === variant);
  variant = VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length].key;
  screenStart = now();
  refreshBar();
}
function setPriv(v: boolean) {
  priv = v;
  refreshBar();
}
refreshBar();
