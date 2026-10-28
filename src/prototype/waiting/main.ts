// PROTOTYPE (throwaway): "Prototype: Waiting-for-opponent animation".
// Question: what should the screen look like while waiting for an opponent
// (Matchmaking, or a Private match's waiting screen with the Invite link)?
//
// Four structurally different variants of one new page, switchable with ← / → (or ?variant=A..D),
// each in Public or Private mode (key M, or ?mode=public|private). In Private mode press C to
// "copy" the Invite link. Runs on the real renderer + CRT filter; no networking, no game logic.
//
// Hacky on purpose: reaches into AsciiGameView's privates to hide / show the 3D world and to
// draw extra text right before the ASCII pass.
import * as THREE from 'three';
import '../../app/app.css';
import { AppShell } from '../../app/AppShell';
import type { GameSession, SessionStatus } from '../../app/GameSession';
import { KeyboardTypingInput } from '../../input/KeyboardTypingInput';
import type { PaletteColor, TextGrid } from '../../render/AsciiRenderer';
import type { GpuAsciiRenderer } from '../../render/GpuAsciiRenderer';
import { AsciiGameView } from '../../view/AsciiGameView';
import { worldToGrid } from '../../view/cockpit/gridProjection';
import { ENEMY_LOOK, type EnemyShip } from '../../view/enemy/EnemyShip';
import type { GameViewState } from '../../view/GameViewState';

type Variant = 'A' | 'B' | 'C' | 'D';
type Mode = 'public' | 'private';
const VARIANTS: { key: Variant; name: string }[] = [
  { key: 'A', name: 'Radar scope' },
  { key: 'B', name: 'Hyperspace jump' },
  { key: 'C', name: 'Terminal log' },
  { key: 'D', name: 'Signal lock' },
];

const COLS = 128;
const ASPECT = 1.6; // cell height / width
const LINK = 'https://typingame.example/#/m/K7Q2-9XPD';

const params = new URLSearchParams(location.search);
let variant: Variant = (VARIANTS.find((v) => v.key === params.get('variant'))?.key ?? 'A') as Variant;
let mode: Mode = params.get('mode') === 'private' ? 'private' : 'public';
let t0 = performance.now();
let copiedAt = -99;

/** The shell needs a session; this one just holds a constant snapshot (pace drives the star speed). */
class ProtoSession implements GameSession {
  status: SessionStatus = 'running';
  pace = { player: 0, enemy: 0 };
  start() {}
  dispose() {}
  attachInput() {}
  update() {
    return [];
  }
  state(): GameViewState {
    return { lives: 3, typedWord: '', attackWord: '', wordBullets: [], shots: [], enemyDamage: 0, pace: this.pace };
  }
}

const session = new ProtoSession();
const input = new KeyboardTypingInput();
input.setEnabled(false);
const view = await AsciiGameView.create();
const hidden = view as unknown as {
  ascii: GpuAsciiRenderer;
  scene: THREE.Scene;
  overlay: THREE.Scene;
  camera: THREE.Camera;
  enemy: EnemyShip;
};
const text: TextGrid = hidden.ascii.textGrid;

// Draw the variant's text right before the ASCII pass (after the game view wrote its own).
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
const centeredScaled = (r: number, s: string, scale: number, col?: PaletteColor) =>
  text.writeScaled((COLS - [...s].length * scale) / 2, r, s, scale, col);
const clock = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const dots = (t: number) => '.'.repeat(1 + (Math.floor(t * 2) % 3)).padEnd(3);
const lineGlyph = (a: number) => ['-', '/', '|', '\\'][Math.round((((a % Math.PI) + Math.PI) % Math.PI) / (Math.PI / 4)) % 4];

function box(c0: number, r0: number, w: number, h: number, color: PaletteColor = 'dim') {
  text.fill(c0, r0, w, h, ' ');
  put(c0, r0, '+' + '-'.repeat(w - 2) + '+', color);
  put(c0, r0 + h - 1, '+' + '-'.repeat(w - 2) + '+', color);
  for (let r = r0 + 1; r < r0 + h - 1; r++) {
    put(c0, r, '|', color);
    put(c0 + w - 1, r, '|', color);
  }
}

/** The Private match's Invite link panel (same in every variant). */
function invitePanel(row: number, t: number) {
  const w = 62;
  const c0 = Math.round((COLS - w) / 2);
  box(c0, row, w, 5, 'fg');
  put(c0 + 3, row + 1, 'INVITE LINK', 'dim');
  put(c0 + 3, row + 2, LINK, 'yellow');
  const copied = t - copiedAt < 1.6;
  put(c0 + w - 20, row + 3, copied ? 'COPIED!' : '[C] COPY LINK', copied ? 'green' : 'fg');
}

const title = () => (mode === 'private' ? 'WAITING FOR YOUR FRIEND' : 'SEARCHING FOR AN OPPONENT');

// ---------------------------------------------------------------- variants

/** A: a big Radar scope takes the screen; contacts light up as the sweep passes, none is the opponent. */
function drawA(t: number) {
  text.clear();
  const priv = mode === 'private';
  const R = priv ? 11 : 15;
  const cx = COLS / 2;
  const cy = priv ? 15 : 19;
  const cell = (rad: number, a: number) => ({ c: Math.round(cx + Math.cos(a) * rad * ASPECT), r: Math.round(cy - Math.sin(a) * rad) });
  const dot = (rad: number, a: number, ch: string, col: PaletteColor) => {
    const p = cell(rad, a);
    put(p.c, p.r, ch, col);
  };

  for (const rad of [R, (R * 2) / 3, R / 3]) for (let d = 0; d < 360; d += 2) dot(rad, (d * Math.PI) / 180, rad === R ? ':' : '.', rad === R ? 'fg' : 'dim');
  for (let k = -R; k <= R; k += 3) {
    dot(Math.abs(k), k < 0 ? Math.PI : 0, '+', 'dim');
    dot(Math.abs(k), k < 0 ? -Math.PI / 2 : Math.PI / 2, '+', 'dim');
  }

  const speed = 1.4;
  const sweep = (t * speed) % (Math.PI * 2);
  for (let k = 11; k >= 0; k--) {
    const a = sweep - k * 0.07;
    for (let rad = 1; rad < R; rad += 0.4) dot(rad, a, k === 0 ? lineGlyph(a) : k < 4 ? ':' : '.', k === 0 ? 'fg' : 'dim');
  }

  // Contacts: 7 fixed slots, new positions every 9 s; lit for 2.5 s after the sweep passes them.
  const cycle = Math.floor(t / 9);
  for (let i = 0; i < 7; i++) {
    const ang = hash(i * 7.3 + cycle) * Math.PI * 2;
    const rad = 2 + hash(i * 3.1 + cycle * 1.7) * (R - 3);
    const since = ((((sweep - ang) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / speed;
    if (since < 2.6) dot(rad, ang, since < 0.7 ? 'O' : since < 1.5 ? 'o' : '.', since < 1.5 ? 'fg' : 'dim');
  }
  put(cx - 2, cy, '-<^>-', 'fg');

  centeredScaled(2, title() + dots(t), 1.4, 'fg');
  if (priv) invitePanel(cy + R + 3, t);
  centered(cy + R + (priv ? 9 : 4), `ELAPSED ${clock(t)}`, 'fg');
  centered(cy + R + (priv ? 11 : 6), 'LANGUAGE: ENGLISH        [Q] CANCEL', 'dim');
}

/** B: the real Cockpit flying through a star tunnel while the game "jumps" to find someone. */
function drawB(t: number) {
  const priv = mode === 'private';
  text.fill(30, 15, 68, 10, ' ');
  centeredScaled(16.5, title(), 1.6, 'fg');
  centered(20, `JUMPING THROUGH SECTOR ${String(7 + Math.floor(t / 2)).padStart(2, '0')}${dots(t)}`, 'dim');
  centered(22, `ELAPSED ${clock(t)}`, 'fg');
  text.fill(40, 1, 48, 3, ' ');
  centered(2, 'LANGUAGE: ENGLISH        [Q] CANCEL', 'dim');
  if (priv) invitePanel(5, t);
}

/** C: no graphics, a terminal that logs each step and keeps reporting "no contact". */
function drawC(t: number) {
  text.clear();
  const priv = mode === 'private';
  const c0 = 22;
  const w = 84;
  const top = priv ? 3 : 4;
  const h = priv ? 26 : 30;
  box(c0, top, w, h, 'dim');
  put(c0 + 3, top, priv ? ' PRIVATE CHANNEL ' : ' MATCHMAKING CHANNEL ', 'fg');

  const base: [string, string, PaletteColor][] = priv
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
  const lineAt = (i: number): [string, string, PaletteColor] =>
    i < base.length ? base[i] : [priv ? `PINGING GUEST SLOT ${i - base.length + 1}` : `SCANNING SECTOR ${String(7 + ((i - 3) * 5) % 40).padStart(2, '0')}`, 'NO CONTACT', 'yellow'];

  const shown = Math.floor(t / 0.85) + 1;
  const visible = h - 4;
  for (let n = 0; n < Math.min(shown, visible); n++) {
    const i = shown > visible ? shown - visible + n : n;
    const [label, status, color] = lineAt(i);
    const leader = '.'.repeat(Math.max(2, 58 - label.length));
    put(c0 + 3, top + 2 + n, `> ${label} ${leader}`, 'fg');
    put(c0 + 3 + 62, top + 2 + n, status, color);
  }
  const last = Math.min(shown, visible) - 1;
  if (Math.floor(t * 2) % 2 === 0) put(c0 + 3, top + 2 + last + 1, '> _', 'fg');

  // Signal strength meter wobbles but never fills.
  const sig = 0.18 + 0.2 * (0.5 + 0.5 * Math.sin(t * 1.3)) + 0.1 * hash(Math.floor(t * 6));
  const n = Math.round(sig * 40);
  put(c0 + 3, top + h - 2, `SIGNAL [${'#'.repeat(n)}${'-'.repeat(40 - n)}]  ELAPSED ${clock(t)}`, 'dim');
  if (priv) invitePanel(top + h + 1, t);
  centered(priv ? 41 : top + h + 2, 'LANGUAGE: ENGLISH        [Q] CANCEL', 'dim');
}

/** D: the real Enemy ship, far away and flickering, with a targeting reticle that never locks. */
function drawD(t: number) {
  const priv = mode === 'private';
  const s = 0.5 + 0.45 * Math.sin(t * 0.5 - 1.2); // signal strength, waxes and wanes
  ENEMY_LOOK.position.z = -75 + (priv ? 18 : 28) * s;
  hidden.enemy.root.visible = hash(Math.floor(t * 14)) < Math.min(1, s * 1.35);

  text.fill(30, 1, 68, 5, ' ');
  centeredScaled(1.5, (priv ? 'WAITING FOR YOUR FRIEND' : 'ACQUIRING OPPONENT') + dots(t), 1.4, 'fg');
  centered(4, 'LANGUAGE: ENGLISH        [Q] CANCEL', 'dim');

  const g = worldToGrid(hidden.enemy.root.position, hidden.camera);
  const c = Math.round(g.col);
  const r = Math.round(g.row);
  const pulse = 8 + Math.round(1.5 * Math.sin(t * 3));
  const color: PaletteColor = s > 0.75 ? 'yellow' : 'dim';
  if (Math.floor(t * 4) % 4 !== 3) {
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      put(c + dx * pulse - (dx > 0 ? 1 : 0), r + dy * 3, dx > 0 ? '-+' : '+-', color);
    }
  }
  put(c - 6, r + 5, `SIGNAL ${String(Math.round(s * 100)).padStart(3)}%  NO LOCK`, color);
  centered(26, `ELAPSED ${clock(t)}`, 'fg');
  if (priv) invitePanel(8, t);
}

function drawVariant() {
  const t = (performance.now() - t0) / 1000;
  const world = variant === 'B' || variant === 'D';
  hidden.scene.visible = world;
  hidden.overlay.visible = world;
  hidden.enemy.root.visible = false;
  session.pace = variant === 'B' ? { player: 9, enemy: 9 } : { player: 0, enemy: 0 };
  if (variant !== 'D') ENEMY_LOOK.position.z = -27;
  ({ A: drawA, B: drawB, C: drawC, D: drawD })[variant](t);
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
