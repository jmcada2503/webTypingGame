// PROTOTYPE ("Cockpit design"): four radically different Cockpits, ?variant=A..D. Throwaway.
// Cockpit geometry lives in camera-local space (group at the camera, looking down -z). Screens are
// black planes (→ blank cells); their text is written into the TextGrid at the screen's projected spot.
import * as THREE from 'three';
import type { PaletteColor, TextGrid } from '../../render/AsciiRenderer';
import { ASCII_STYLE } from '../../render/asciiStyle';
import type { GameViewState } from '../GameViewState';
import { WORD_FLIGHT } from '../words/flightPath';

export const COCKPIT_VARIANTS = [
  { key: 'A', name: 'Dashboard console: 3 screens, keyboard, pillars' },
  { key: 'B', name: 'Fighter HUD: canopy frame, text over space' },
  { key: 'C', name: 'Porthole: round window in a riveted bulkhead' },
  { key: 'D', name: 'Pilot controls: yoke, side consoles, life lamps' },
];

export type CockpitCtx = { state: GameViewState; dt: number; text: TextGrid };
export interface Cockpit {
  update(ctx: CockpitCtx): void;
  dispose(): void;
}

const MAX_LIVES = 3;

export function createCockpit(key: string, scene: THREE.Scene, camera: THREE.PerspectiveCamera): Cockpit {
  const build = { A: dashboard, B: hud, C: porthole, D: yoke }[key] ?? dashboard;
  return build(scene, camera);
}

// ---------------------------------------------------------------- helpers

const gray = (v: number, flat = true) => new THREE.MeshLambertMaterial({ color: new THREE.Color(v, v, v), flatShading: flat });
const black = () => new THREE.MeshBasicMaterial({ color: 0x000000 });
const box = (w: number, h: number, d: number, m: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const screen = (w: number, h: number) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), black());

/** Group that follows the camera; children are in camera-local coordinates. */
function rig(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
  const g = new THREE.Group();
  g.position.copy(camera.position);
  scene.add(g);
  return g;
}

type Rect = { c0: number; r0: number; c1: number; r1: number };
const tmpBox = new THREE.Box3();
const corner = new THREE.Vector3();

/** Grid cells covered by an object on screen. */
function rectOf(obj: THREE.Object3D, camera: THREE.Camera): Rect {
  const { cols, rows } = ASCII_STYLE.grid;
  obj.updateWorldMatrix(true, true);
  tmpBox.setFromObject(obj);
  let c0 = Infinity, r0 = Infinity, c1 = -Infinity, r1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? tmpBox.max.x : tmpBox.min.x, i & 2 ? tmpBox.max.y : tmpBox.min.y, i & 4 ? tmpBox.max.z : tmpBox.min.z).project(camera);
    const c = ((corner.x + 1) / 2) * cols;
    const r = ((1 - corner.y) / 2) * rows;
    c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r);
  }
  return { c0: Math.round(c0), r0: Math.round(r0), c1: Math.round(c1), r1: Math.round(r1) };
}

/** Write `str` centered in the rect, `line` rows from its vertical center. */
function center(text: TextGrid, rect: Rect, line: number, str: string, color: PaletteColor = 'fg') {
  const len = [...str].length;
  const col = Math.round((rect.c0 + rect.c1) / 2 - len / 2);
  const row = Math.round((rect.r0 + rect.r1) / 2 - 0.5) + line;
  text.write(col, row, str, color);
}

function hearts(text: TextGrid, rect: Rect, line: number, lives: number) {
  const col = Math.round((rect.c0 + rect.c1) / 2 - (MAX_LIVES * 2 - 1) / 2);
  const row = Math.round((rect.r0 + rect.r1) / 2 - 0.5) + line;
  for (let i = 0; i < MAX_LIVES; i++) text.write(col + i * 2, row, '♥', i < lives ? 'red' : 'dim');
}

const cursor = (t: number) => (Math.floor(t * 2) % 2 === 0 ? '_' : ' ');

function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
  root.removeFromParent();
}

// ---------------------------------------------------------------- A
/** Sloped dashboard across the bottom with three inset screens, a keyboard, levers; window pillars. */
function dashboard(scene: THREE.Scene, camera: THREE.PerspectiveCamera): Cockpit {
  const root = rig(scene, camera);
  const panel = new THREE.Group();
  panel.position.set(0, -0.6, -1.9);
  panel.rotation.x = -0.75; // tilted back so the player sees its face
  root.add(panel);

  const base = box(3.4, 0.7, 0.1, gray(0.35));
  base.position.set(0, 0, -0.06);
  panel.add(base);

  const mkScreen = (x: number, w: number) => {
    const bezel = box(w + 0.08, 0.26, 0.04, gray(0.7));
    bezel.position.set(x, 0.12, 0);
    const s = screen(w, 0.18);
    s.position.set(x, 0.12, 0.025);
    panel.add(bezel, s);
    return s;
  };
  const left = mkScreen(-0.95, 0.42);
  const mid = mkScreen(0, 0.86);
  const right = mkScreen(0.95, 0.42);

  // Keyboard: 3 rows of keys below the screens.
  const keyMat = gray(0.8);
  const keyGeo = new THREE.BoxGeometry(0.055, 0.045, 0.025);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 12 - r; c++) {
      const k = new THREE.Mesh(keyGeo, keyMat);
      k.position.set((c - (11 - r) / 2) * 0.068 + r * 0.02, -0.12 - r * 0.062, 0.02);
      panel.add(k);
    }
  }

  for (const x of [-1.45, 1.45]) {
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.3, 8), gray(0.8, false));
    lever.position.set(x, 0.0, 0.15);
    lever.rotation.x = Math.PI / 2 - 0.4;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), gray(0.9, false));
    knob.position.set(x, 0.06, 0.29);
    panel.add(lever, knob);
  }

  // Window frame: two slanted pillars + top bar.
  for (const side of [-1, 1]) {
    const pillar = box(0.07, 1.8, 0.07, gray(0.55));
    pillar.position.set(side * 1.05, 0, -1.7);
    pillar.rotation.z = side * 0.32;
    root.add(pillar);
  }
  const top = box(2.6, 0.08, 0.1, gray(0.55));
  top.position.set(0, 0.62, -1.7);
  root.add(top);

  let t = 0;
  return {
    update({ state, dt, text }) {
      t += dt;
      WORD_FLIGHT.end.y = -0.55;
      const L = rectOf(left, camera), M = rectOf(mid, camera), R = rectOf(right, camera);
      center(text, L, -1, 'LIVES', 'dim');
      hearts(text, L, 1, state.lives);
      center(text, M, -1, 'TYPED', 'dim');
      center(text, M, 1, `> ${state.typedWord}${cursor(t)}`);
      center(text, R, -1, 'ATTACK', 'dim');
      center(text, R, 1, state.attackWord, 'red');
    },
    dispose: () => disposeTree(root),
  };
}

// ---------------------------------------------------------------- B
/** Minimal: canopy arch + low dash; readouts are HUD text straight over space. */
function hud(scene: THREE.Scene, camera: THREE.PerspectiveCamera): Cockpit {
  const root = rig(scene, camera);
  const arch = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.03, 8, 64, Math.PI), gray(0.6, false));
  arch.position.set(0, -0.5, -1.5);
  arch.scale.set(1.15, 1, 1);
  root.add(arch);
  const dash = box(3.2, 0.16, 0.6, gray(0.18));
  dash.position.set(0, -0.66, -1.4);
  dash.rotation.x = 0.35;
  root.add(dash);
  for (const x of [-0.5, 0.5]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    lamp.position.set(x, -0.5, -1.25);
    root.add(lamp);
  }

  let t = 0;
  return {
    update({ state, dt, text }) {
      t += dt;
      WORD_FLIGHT.end.y = -1.1;
      const { cols, rows } = text;
      const cx = Math.floor(cols / 2), cy = Math.floor(rows / 2);
      // Reticle + side ladders, dim so Word bullets stay the focus.
      text.write(cx - 4, cy, '-- ', 'dim');
      text.write(cx + 2, cy, ' --', 'dim');
      for (let i = -3; i <= 3; i++) {
        text.write(cx - 30, cy + i * 3, i === 0 ? '-+-' : ' - ', 'dim');
        text.write(cx + 28, cy + i * 3, i === 0 ? '-+-' : ' - ', 'dim');
      }
      const row = rows - 6;
      // Blank pads so HUD text reads over the dash / stars.
      const pad = (col: number, r: number, w: number) => text.fill(col - 1, r, w + 2, 1, ' ');
      pad(6, row - 1, 5);
      pad(6, row, MAX_LIVES * 2 - 1);
      text.write(6, row - 1, 'LIVES', 'dim');
      for (let i = 0; i < MAX_LIVES; i++) text.write(6 + i * 2, row, '♥', i < state.lives ? 'red' : 'dim');
      const typed = `[ ${state.typedWord}${cursor(t)} ]`;
      const tl = [...typed].length;
      pad(cx - Math.floor(tl / 2), row, tl);
      text.write(cx - Math.floor(tl / 2), row, typed);
      const al = [...state.attackWord].length;
      pad(cols - 12, row - 1, 6);
      pad(cols - 6 - al, row, al);
      text.write(cols - 6 - 6, row - 1, 'ATTACK', 'dim');
      text.write(cols - 6 - al, row, state.attackWord, 'red');
    },
    dispose: () => disposeTree(root),
  };
}

// ---------------------------------------------------------------- C
/** View through a round porthole in a riveted bulkhead; dial + screens below it. */
function porthole(scene: THREE.Scene, camera: THREE.PerspectiveCamera): Cockpit {
  const root = rig(scene, camera);
  const d = 1.2;
  const holeR = 0.36;
  const holeY = 0.06;
  const wall = new THREE.Shape([new THREE.Vector2(-1.2, -0.7), new THREE.Vector2(1.2, -0.7), new THREE.Vector2(1.2, 0.7), new THREE.Vector2(-1.2, 0.7)]);
  wall.holes.push(new THREE.Path().absarc(0, holeY, holeR, 0, Math.PI * 2, true));
  const bulkhead = new THREE.Mesh(new THREE.ShapeGeometry(wall, 48), gray(0.32, false));
  bulkhead.position.z = -d;
  bulkhead.rotation.x = 0.12;
  root.add(bulkhead);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(holeR + 0.015, 0.03, 12, 64), gray(0.8, false));
  ring.position.set(0, holeY, -d + 0.02);
  root.add(ring);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), gray(0.9, false));
    rivet.position.set(Math.cos(a) * (holeR + 0.07), holeY + Math.sin(a) * (holeR + 0.07), -d + 0.02);
    root.add(rivet);
  }
  // Panel seams.
  for (const x of [-0.75, 0.75]) {
    const seam = box(0.012, 1.4, 0.01, gray(0.6));
    seam.position.set(x, 0, -d + 0.01);
    root.add(seam);
  }
  const strip = screen(0.62, 0.075);
  strip.position.set(0, -0.355, -d + 0.02);
  const dial = new THREE.Mesh(new THREE.CircleGeometry(0.11, 32), black());
  dial.position.set(-0.6, -0.3, -d + 0.02);
  const dialRim = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.012, 8, 32), gray(0.8, false));
  dialRim.position.copy(dial.position);
  const right = screen(0.3, 0.11);
  right.position.set(0.6, -0.3, -d + 0.02);
  const rightRim = box(0.33, 0.14, 0.01, gray(0.8));
  rightRim.position.set(0.6, -0.3, -d + 0.012);
  root.add(rightRim, strip, dial, dialRim, right);

  let t = 0;
  return {
    update({ state, dt, text }) {
      t += dt;
      WORD_FLIGHT.end.y = -0.7;
      const S = rectOf(strip, camera), D = rectOf(dial, camera), R = rectOf(right, camera);
      center(text, S, 0, `> ${state.typedWord}${cursor(t)}`);
      center(text, D, -1, 'LIVES', 'dim');
      hearts(text, D, 1, state.lives);
      center(text, R, -1, 'ATTACK', 'dim');
      center(text, R, 1, state.attackWord, 'red');
    },
    dispose: () => disposeTree(root),
  };
}

// ---------------------------------------------------------------- D
/** Control yoke center-bottom with the Typed word screen between the grips; side consoles; life lamps. */
function yoke(scene: THREE.Scene, camera: THREE.PerspectiveCamera): Cockpit {
  const root = rig(scene, camera);
  const metal = gray(0.75, false);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.6, 12), metal);
  column.position.set(0, -0.78, -1.35);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 12), metal);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, -0.48, -1.35);
  root.add(column, bar);
  for (const x of [-0.45, 0.45]) {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.28, 12), gray(0.9, false));
    grip.position.set(x, -0.4, -1.35);
    root.add(grip);
  }
  const yokeScreenBezel = box(0.62, 0.12, 0.03, gray(0.45));
  yokeScreenBezel.position.set(0, -0.4, -1.37);
  const yokeScreen = screen(0.56, 0.08);
  yokeScreen.position.set(0, -0.4, -1.35);
  root.add(yokeScreenBezel, yokeScreen);

  const consoles = new THREE.Group();
  const lamps: THREE.Mesh[] = [];
  const lampOn = new THREE.MeshBasicMaterial({ color: ASCII_STYLE.palette.red });
  const lampOff = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
  let attackScreen!: THREE.Mesh;
  for (const side of [-1, 1]) {
    const c = new THREE.Group();
    c.position.set(side * 0.72, -0.5, -1.6);
    c.rotation.set(-0.7, -side * 0.4, 0);
    const slab = box(0.62, 0.42, 0.06, gray(0.28));
    c.add(slab);
    if (side < 0) {
      for (let i = 0; i < MAX_LIVES; i++) {
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 10), lampOn);
        lamp.position.set(-0.15 + i * 0.15, 0.05, 0.06);
        lamps.push(lamp);
        c.add(lamp);
      }
    } else {
      const bezel = box(0.5, 0.2, 0.03, gray(0.7));
      bezel.position.set(0, 0.05, 0.05);
      attackScreen = screen(0.44, 0.14);
      attackScreen.position.set(0, 0.05, 0.07);
      c.add(bezel, attackScreen);
    }
    // Switch row.
    for (let i = 0; i < 5; i++) {
      const sw = box(0.04, 0.07, 0.04, gray(0.85));
      sw.position.set(-0.2 + i * 0.1, -0.13, 0.06);
      c.add(sw);
    }
    consoles.add(c);
  }
  root.add(consoles);
  const overhead = box(3, 0.12, 0.5, gray(0.4));
  overhead.position.set(0, 0.68, -1.3);
  root.add(overhead);

  let t = 0;
  return {
    update({ state, dt, text }) {
      t += dt;
      WORD_FLIGHT.end.y = -0.6;
      lamps.forEach((l, i) => (l.material = i < state.lives ? lampOn : lampOff));
      const Y = rectOf(yokeScreen, camera), R = rectOf(attackScreen, camera);
      center(text, Y, 0, `> ${state.typedWord}${cursor(t)}`);
      center(text, R, -1, 'ATTACK', 'dim');
      center(text, R, 1, state.attackWord, 'red');
      const L = rectOf(lamps[1], camera);
      center(text, L, -2, 'LIVES', 'dim');
    },
    dispose: () => {
      disposeTree(root);
      lampOn.dispose();
      lampOff.dispose();
    },
  };
}
