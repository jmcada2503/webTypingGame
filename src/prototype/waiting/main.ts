// PROTOTYPE (throwaway): "Prototype: Waiting-for-opponent animation", round 2.
// The user picked the terminal-style screen (C) and asked for (1) less empty, (2) a title that
// makes it obvious WHO we're waiting for. C0 is the original C; C1..C4 are four ways to fix both.
// (Round 1 variants A/B/D are in the first commit of this branch.)
//
// Switch with ← / → (or ?variant=C0..C4); M toggles Public/Private; in Private press C to "copy"
// the Invite link. Real renderer + CRT filter; no networking, no game logic.
import * as THREE from 'three';
import '../../app/app.css';
import { AppShell } from '../../app/AppShell';
import type { GameSession, SessionStatus } from '../../app/GameSession';
import { KeyboardTypingInput } from '../../input/KeyboardTypingInput';
import type { PaletteColor, TextGrid } from '../../render/AsciiRenderer';
import type { GpuAsciiRenderer } from '../../render/GpuAsciiRenderer';
import { AsciiGameView } from '../../view/AsciiGameView';
import type { GameViewState } from '../../view/GameViewState';

type Variant = 'C0' | 'C1' | 'C2' | 'C3' | 'C4';
type Mode = 'public' | 'private';
const VARIANTS: { key: Variant; name: string }[] = [
  { key: 'C0', name: 'Current C (baseline)' },
  { key: 'C1', name: 'VS cards' },
  { key: 'C2', name: 'Split: banner + radar + log' },
  { key: 'C3', name: 'Banner + ticker + tips' },
  { key: 'C4', name: 'Sonar rings + title card' },
];

const COLS = 128;
const ASPECT = 1.6; // cell height / width
const LINK = 'https://typingame.example/#/m/K7Q2-9XPD';

const params = new URLSearchParams(location.search);
let variant: Variant = (VARIANTS.find((v) => v.key === params.get('variant'))?.key ?? 'C1') as Variant;
let mode: Mode = params.get('mode') === 'private' ? 'private' : 'public';
let t0 = performance.now();
let copiedAt = -99;

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
const clock = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const dots = (t: number) => '.'.repeat(1 + (Math.floor(t * 2) % 3)).padEnd(3);
const lineGlyph = (a: number) => ['-', '/', '|', '\\'][Math.round((((a % Math.PI) + Math.PI) % Math.PI) / (Math.PI / 4)) % 4];
const priv = () => mode === 'private';

/** The two-tone title: what we're doing in white, WHO we're waiting for in yellow. */
const TITLE = () => (priv() ? (['WAITING FOR ', 'YOUR FRIEND'] as const) : (['FINDING A ', 'RANDOM OPPONENT'] as const));
const WHO = () => (priv() ? 'YOUR FRIEND' : 'OPPONENT');
const SUBTITLE = () =>
  priv()
    ? 'SEND THEM THE LINK BELOW. THE MATCH STARTS WHEN THEY JOIN.'
    : 'THE MATCH STARTS AS SOON AS ANOTHER PLAYER IS LOOKING TOO.';

/** Two-tone title on one line, centered, at `scale`. */
function titleLine(row: number, scale: number) {
  const [a, b] = TITLE();
  const total = ([...a].length + [...b].length) * scale;
  const c = (COLS - total) / 2;
  text.writeScaled(c, row, a, scale, 'fg');
  text.writeScaled(c + [...a].length * scale, row, b, scale, 'yellow');
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

function invitePanel(row: number, t: number, w = 62, c0 = Math.round((COLS - w) / 2)) {
  box(c0, row, w, 5, 'fg');
  put(c0 + 3, row + 1, 'INVITE LINK', 'dim');
  put(c0 + 3, row + 2, LINK, 'yellow');
  const copied = t - copiedAt < 1.6;
  put(c0 + w - 20, row + 3, copied ? 'COPIED!' : '[C] COPY LINK', copied ? 'green' : 'fg');
}

function logLine(i: number): [string, string, PaletteColor] {
  const base: [string, string, PaletteColor][] = priv()
    ? [
        ['OPENING CHANNEL', 'OK', 'green'],
        ['LANGUAGE', 'ENGLISH', 'fg'],
        ['CREATING PRIVATE MATCH', 'OK', 'green'],
        ['INVITE LINK', 'READY', 'green'],
        ['WAITING FOR GUEST', 'NO ONE YET', 'yellow'],
      ]
    : [
        ['OPENING CHANNEL', 'OK', 'green'],
        ['LANGUAGE', 'ENGLISH', 'fg'],
        ['ENTERING QUEUE', 'OK', 'green'],
        ['SCANNING SECTOR 07', 'NO CONTACT', 'yellow'],
      ];
  if (i < base.length) return base[i];
  const k = i - base.length;
  return [priv() ? `PINGING GUEST SLOT ${k + 1}` : `SCANNING SECTOR ${String(7 + (((k + 1) * 5) % 40)).padStart(2, '0')}`, 'NO CONTACT', 'yellow'];
}

/** The scrolling channel log: last `count` lines, blinking cursor under it (reserve count + 1 rows). */
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
  if (Math.floor(t * 2) % 2 === 0) put(c0, row + n, '> _', 'fg');
}

/** Wobbling signal meter that never fills. */
function signalBar(c0: number, row: number, len: number, t: number, label = 'SIGNAL') {
  const sig = 0.18 + 0.2 * (0.5 + 0.5 * Math.sin(t * 1.3)) + 0.1 * hash(Math.floor(t * 6));
  const n = Math.round(sig * len);
  put(c0, row, `${label} [${'#'.repeat(n)}${'-'.repeat(len - n)}]`, 'dim');
}

function drawRadar(cx: number, cy: number, R: number, t: number) {
  const cell = (rad: number, a: number) => ({ c: Math.round(cx + Math.cos(a) * rad * ASPECT), r: Math.round(cy - Math.sin(a) * rad) });
  const dot = (rad: number, a: number, ch: string, col: PaletteColor) => {
    const p = cell(rad, a);
    put(p.c, p.r, ch, col);
  };
  for (const rad of [R, (R * 2) / 3, R / 3]) for (let d = 0; d < 360; d += 3) dot(rad, (d * Math.PI) / 180, rad === R ? ':' : '.', rad === R ? 'fg' : 'dim');
  const speed = 1.4;
  const sweep = (t * speed) % (Math.PI * 2);
  for (let k = 10; k >= 0; k--) {
    const a = sweep - k * 0.08;
    for (let rad = 1; rad < R; rad += 0.4) dot(rad, a, k === 0 ? lineGlyph(a) : k < 4 ? ':' : '.', k === 0 ? 'fg' : 'dim');
  }
  const cycle = Math.floor(t / 9);
  for (let i = 0; i < 5; i++) {
    const ang = hash(i * 7.3 + cycle) * Math.PI * 2;
    const rad = 2 + hash(i * 3.1 + cycle * 1.7) * (R - 3);
    const since = ((((sweep - ang) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / speed;
    if (since < 2.6) dot(rad, ang, since < 0.7 ? 'O' : since < 1.5 ? 'o' : '.', since < 1.5 ? 'fg' : 'dim');
  }
  put(cx - 2, cy, '-<^>-', 'fg');
}

const SHIP = ['     /\\     ', '   _/  \\_   ', '  /_/\\/\\_\\  ', '    \\__/    '];

/** The ship shape, drawn solid (you) or as flickering static (not here yet). */
function drawShip(c0: number, row: number, t: number, solid: boolean) {
  const signal = 0.4 + 0.3 * Math.sin(t * 0.9);
  const glyphs = '.:;=*#';
  SHIP.forEach((line, y) => {
    [...line].forEach((ch, x) => {
      if (ch === ' ') return;
      if (solid) return put(c0 + x, row + y, ch, 'fg');
      if (hash(Math.floor(t * 12) + x * 3.1 + y * 17.3) < signal) put(c0 + x, row + y, glyphs[Math.floor(hash(x * 5.7 + y * 2.3 + Math.floor(t * 12)) * glyphs.length)], 'dim');
    });
  });
}

// ---------------------------------------------------------------- variants

/** C0: the original terminal screen (baseline to compare against). */
function drawC0(t: number) {
  const p = priv();
  const c0 = 22;
  const w = 84;
  const top = p ? 3 : 4;
  const h = p ? 26 : 30;
  box(c0, top, w, h, 'dim');
  put(c0 + 3, top, p ? ' PRIVATE CHANNEL ' : ' MATCHMAKING CHANNEL ', 'fg');
  drawLog(c0 + 3, top + 2, w - 4, h - 5, t);
  signalBar(c0 + 3, top + h - 2, 40, t);
  put(c0 + 3 + 56, top + h - 2, `ELAPSED ${clock(t)}`, 'dim');
  if (p) invitePanel(top + h + 1, t);
  centered(p ? 41 : top + h + 2, 'LANGUAGE: ENGLISH        [Q] CANCEL', 'dim');
}

/** C1: lobby "VS" cards: YOU (ready) against a static-filled empty slot for who we wait for. */
function drawC1(t: number) {
  const p = priv();
  const off = p ? 0 : 2;
  titleLine(2 + off, 2.3);
  centered(5.5 + off, SUBTITLE(), 'dim');
  const r0 = 9 + off;
  const h = 15;
  const w = 38;
  const left = 22;
  const right = 68;
  box(left, r0, w, h, 'fg');
  put(left + 2, r0, ' YOU ', 'fg');
  drawShip(left + 13, r0 + 4, t, true);
  put(left + 15, r0 + 11, 'READY', 'green');
  box(right, r0, w, h, 'dim');
  put(right + 2, r0, ` ${WHO()} `, 'yellow');
  drawShip(right + 13, r0 + 4, t, false);
  put(right + 8, r0 + 11, (p ? 'NOT JOINED YET' : 'SEARCHING') + dots(t), 'yellow');
  text.writeScaled(61, r0 + h / 2 - 1.5, 'VS', 2.6, 'yellow');
  drawLog(left, r0 + h + 2, 84, 3, t);
  if (p) invitePanel(r0 + h + 7, t);
  centered(p ? 40 : 35, `ELAPSED ${clock(t)}        LANGUAGE: ENGLISH        [Q] CANCEL`, 'dim');
}

/** C2: split screen: huge banner + a small radar on the left, the channel log on the right. */
function drawC2(t: number) {
  const p = priv();
  const [a, b] = p ? (['WAITING FOR', 'YOUR FRIEND'] as const) : (['FINDING A', 'RANDOM OPPONENT'] as const);
  text.writeScaled(6, 3, a, 3, 'fg');
  text.writeScaled(6, 7, b, 3, 'yellow');
  put(6, 12, p ? 'SEND THEM THE LINK. THE MATCH STARTS WHEN THEY JOIN.' : 'THE MATCH STARTS WHEN ANOTHER PLAYER IS LOOKING TOO.', 'dim');
  drawRadar(34, 28, 10, t);
  const c0 = 70;
  box(c0, 4, 54, 22, 'dim');
  put(c0 + 3, 4, p ? ' PRIVATE CHANNEL ' : ' MATCHMAKING CHANNEL ', 'fg');
  drawLog(c0 + 3, 6, 48, 16, t);
  signalBar(c0 + 3, 24, 28, t);
  if (p) invitePanel(28, t, 54, c0);
  text.writeScaled(c0, p ? 35.5 : 29, `ELAPSED ${clock(t)}`, 1.6, 'fg');
  put(c0, p ? 38 : 32, 'LANGUAGE: ENGLISH        [Q] CANCEL', 'dim');
}

const TIPS = [
  "TYPE A WORD BULLET'S WORD TO DESTROY IT BEFORE IT HITS YOU",
  'TYPE YOUR ATTACK WORD AND PRESS ENTER TO FIRE AT YOUR OPPONENT',
  'DEFENDING COMES FIRST: A MATCHING WORD BULLET IS DESTROYED BEFORE YOUR ATTACK FIRES',
  'YOU HAVE 3 LIVES. EVERY WORD BULLET THAT REACHES YOU COSTS ONE',
  'IF BOTH PLAYERS STAY IDLE FOR 10 SECONDS, THE MATCH ENDS IN PEACE',
];

/** C3: scrolling ticker tape top and bottom, big banner, rotating tips and the online count. */
function drawC3(t: number) {
  const p = priv();
  const ticker = (row: number, dir: number) => {
    const unit = `${p ? 'WAITING FOR YOUR FRIEND' : 'FINDING A RANDOM OPPONENT'}   ///   `;
    const strip = unit.repeat(Math.ceil(COLS / unit.length) + 2);
    const shift = Math.floor(t * 10 * dir);
    put(0, row, strip.slice(((shift % unit.length) + unit.length) % unit.length).slice(0, COLS), 'yellow');
  };
  ticker(1, 1);
  ticker(43, -1);
  box(14, 5, 100, 9, 'fg');
  titleLine(7, 2.6);
  centered(11.5, SUBTITLE(), 'dim');
  const tip = TIPS[Math.floor(t / 6) % TIPS.length];
  const typed = tip.slice(0, Math.floor((t % 6) * 22));
  put(14, 17, 'TIP', 'yellow');
  put(18, 17, typed + (Math.floor(t * 2) % 2 === 0 ? '_' : ' '), 'fg');
  put(14, 20, 'ONLINE NOW', 'dim');
  put(26, 20, '128     ENGLISH 97   SPANISH 31', 'fg');
  // Private shows the Invite link panel, so the log is short; Public gives that space to the log.
  drawLog(14, 23, 100, p ? 3 : 10, t);
  if (p) invitePanel(29, t);
  else signalBar(14, 35, 60, t);
  centered(p ? 36 : 38, `ELAPSED ${clock(t)}`, 'fg');
  centered(p ? 38 : 40, 'LANGUAGE: ENGLISH        [Q] CANCEL', 'dim');
}

/** C4: sonar pings radiate across the whole screen behind a title card; log lines as captions. */
function drawC4(t: number) {
  const p = priv();
  const cx = COLS / 2;
  const cy = p ? 21 : 20;
  for (let k = 0; k < 4; k++) {
    const rad = ((t * 6 + k * 9) % 36) + 1;
    const far = rad > 22;
    for (let d = 0; d < 360; d += 1) {
      const a = (d * Math.PI) / 180;
      const c = Math.round(cx + Math.cos(a) * rad * ASPECT);
      const r = Math.round(cy - Math.sin(a) * rad * 0.9);
      if (c >= 0 && c < COLS && r >= 0 && r < 44) put(c, r, far ? '.' : ':', far ? 'dim' : 'fg');
    }
  }
  const h = p ? 21 : 14;
  const top = p ? 8 : 12;
  box(24, top, 80, h, 'fg');
  titleLine(top + 2, 2.5);
  centered(top + 6, SUBTITLE(), 'dim');
  if (p) {
    invitePanel(top + 9, t, 62);
    centered(top + 16, `ELAPSED ${clock(t)}        LANGUAGE: ENGLISH`, 'fg');
  } else {
    centered(top + 9, `ELAPSED ${clock(t)}        LANGUAGE: ENGLISH`, 'fg');
  }
  centered(top + h - 2, '[Q] CANCEL', 'dim');
  box(24, 38, 80, 6, 'dim');
  const shown = Math.floor(t / 0.85) + 1;
  for (let k = 0; k < 3; k++) {
    const [label, status, color] = logLine(Math.max(0, shown - 3 + k));
    put(27, 39 + k, `> ${label} ${'.'.repeat(Math.max(2, 58 - label.length))}`, 'fg');
    put(27 + 62, 39 + k, status, color);
  }
}

function drawVariant() {
  const t = (performance.now() - t0) / 1000;
  hidden.scene.visible = false;
  hidden.overlay.visible = false;
  text.clear();
  ({ C0: drawC0, C1: drawC1, C2: drawC2, C3: drawC3, C4: drawC4 })[variant](t);
}

// ---------------------------------------------------------------- switcher bar (prototype-only)

const bar = document.createElement('div');
bar.style.cssText =
  'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:99999;display:flex;gap:10px;align-items:center;' +
  'padding:8px 14px;border-radius:999px;background:#ffd400;color:#000;font:600 14px system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.6)';
const mk = (label: string, onclick: () => void) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = 'border:0;background:#000;color:#ffd400;border-radius:999px;padding:4px 12px;font:inherit;cursor:pointer';
  b.onclick = onclick;
  return b;
};
const label = document.createElement('span');
const modeBtn = mk('', () => setMode(mode === 'public' ? 'private' : 'public'));
bar.append(mk('←', () => cycle(-1)), label, mk('→', () => cycle(1)), modeBtn);
document.body.append(bar);

function refreshBar() {
  const v = VARIANTS.find((x) => x.key === variant)!;
  label.textContent = `${v.key} (${v.name})`;
  modeBtn.textContent = `mode: ${mode} (M)`;
  const p = new URLSearchParams(location.search);
  p.set('variant', variant);
  p.set('mode', mode);
  history.replaceState(null, '', `?${p}`);
}
function cycle(d: number) {
  const i = VARIANTS.findIndex((v) => v.key === variant);
  variant = VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length].key;
  t0 = performance.now();
  refreshBar();
}
function setMode(m: Mode) {
  mode = m;
  t0 = performance.now();
  refreshBar();
}
refreshBar();

window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') cycle(-1);
  else if (e.key === 'ArrowRight') cycle(1);
  else if (e.key === 'm') setMode(mode === 'public' ? 'private' : 'public');
  else if (e.key === 'c' && mode === 'private') {
    copiedAt = (performance.now() - t0) / 1000;
    void navigator.clipboard?.writeText(LINK).catch(() => {});
  }
});
