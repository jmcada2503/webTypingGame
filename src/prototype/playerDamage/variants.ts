// PROTOTYPE (throwaway): "Prototype: Player damage (Cockpit smoke and damage by Lives left)".
// Question: what should the player's Cockpit show as Lives are lost (3 intact, 2 lightly damaged, 1 badly damaged)?
// Four variants on the real game scene, switchable with ?variant=A..D (floating bar, Alt+[ / Alt+]):
//   A Smoke + sparks      smoke rising from the consoles, sparks spitting; like the Enemy ship's damage
//   B Cracked glass       cracks spread across the window from the edges; an impact star at 1 Life
//   C Failing systems     flickering panels, dead switches, Radar glitches, ATTACK label stutters, warning text
//   D Broken structure    consoles knocked loose, missing switches, a swinging cable, floating debris
//   E A + C (round 2, the user's mix): smoke and sparks, plus the failing systems
// Every variant: damage stays until the Match ends, 0 Lives keeps the 1-Life look (the Lose ending dims it),
// and each new level is marked the moment the Life goes. Words and the Typed word are never covered.
import * as THREE from 'three';
import type { TextGrid } from '../../render/AsciiRenderer';
import { ASCII_STYLE } from '../../render/asciiStyle';
import type { Cockpit } from '../../view/cockpit/Cockpit';
import { gridRectOf, worldToGrid } from '../../view/cockpit/gridProjection';
import type { SparkBursts } from '../../view/juice/SparkBursts';
import { mountPrototypeSwitcher } from '../PrototypeSwitcher';

export const PLAYER_DAMAGE_VARIANTS = [
  { key: 'A', name: 'Smoke + sparks' },
  { key: 'B', name: 'Cracked glass' },
  { key: 'C', name: 'Failing systems' },
  { key: 'D', name: 'Broken structure' },
  { key: 'E', name: 'A + C: smoke, sparks, failing systems' },
] as const;
type Variant = (typeof PLAYER_DAMAGE_VARIANTS)[number]['key'];

/** Live-tunable from the sandbox panel. */
export const PLAYER_DAMAGE_PROTO = { amount: 1 };

const COLS = ASCII_STYLE.grid.cols;
const tmp = new THREE.Vector3();

/** 3 Lives = 0 (intact), 2 = 1 (light), 1 or 0 = 2 (bad). */
const levelOf = (lives: number) => (lives >= 3 ? 0 : lives === 2 ? 1 : 2);

function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class PlayerDamageProto {
  readonly variant: Variant;
  private level = 0;
  private lastLives = 3;
  private t = 0;
  /** Seconds since the last new damage level (for the mark), Infinity when none yet. */
  private sinceMark = Infinity;
  private readonly base: { pos: THREE.Vector3; rot: THREE.Euler }[];
  private readonly baseColors: THREE.Color[];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly cockpit: Cockpit,
    private readonly sparks: SparkBursts,
  ) {
    this.variant = mountPrototypeSwitcher([...PLAYER_DAMAGE_VARIANTS]) as Variant;
    const p = cockpit.protoParts;
    this.base = p.panels.map((g) => ({ pos: g.position.clone(), rot: g.rotation.clone() }));
    this.baseColors = p.panelMats.map((m) => m.color.clone());
    if (this.variant === 'B') this.buildCracks();
    if (this.variant === 'D') this.buildStructure();
    if (import.meta.env.DEV) Object.assign(window, { playerDamage: this });
  }

  /** Before the Cockpit draws (after the hit shake): bend / break the Cockpit, draw grid effects under its text. */
  update(lives: number, dt: number, text: TextGrid) {
    this.t += dt;
    this.sinceMark += dt;
    if (lives > this.lastLives) this.sinceMark = Infinity; // refilled (sandbox)
    const level = levelOf(lives);
    if (lives < this.lastLives && level > this.level) this.sinceMark = 0; // a new level of damage: mark it
    this.level = level;
    this.lastLives = lives;
    this.reset();
    if (this.variant === 'A' || this.variant === 'E') this.smokeAndSparks(dt, text);
    if (this.variant === 'B') this.cracks(text);
    if (this.variant === 'C' || this.variant === 'E') this.failing(dt);
    if (this.variant === 'D') this.structure(dt);
    if (this.sinceMark === 0) this.mark();
  }

  /** After the Cockpit draws: effects that go over its readouts (the Radar glitch). */
  drawAfter(text: TextGrid) {
    if (this.variant === 'C' || this.variant === 'E') this.radarGlitch(text);
  }

  private reset() {
    const p = this.cockpit.protoParts;
    p.panels.forEach((g, i) => {
      g.position.copy(this.base[i].pos);
      g.rotation.copy(this.base[i].rot);
    });
    p.panelMats.forEach((m, i) => m.color.copy(this.baseColors[i]));
    p.switches.forEach((s) => (s.visible = true));
    this.cockpit.protoLabelOff = false;
  }

  /** Grid position of a point in a console's local space (0 = left / Lives, 1 = right / Radar). */
  private onPanel(i: number, x: number, y: number) {
    const g = this.cockpit.protoParts.panels[i];
    g.updateWorldMatrix(true, false);
    return worldToGrid(g.localToWorld(tmp.set(x, y, 0.05)), this.camera);
  }

  /** The new damage level's mark, when the Life goes. */
  private mark() {
    const side = this.level === 1 ? 0 : 1;
    const at = this.onPanel(side, side === 0 ? 0.15 : -0.2, 0.15);
    if (this.variant === 'A' || this.variant === 'E') {
      this.sparks.burst(at.col, at.row, { count: 22, reach: 6, life: 0.6, color: 'yellow' });
      this.sparks.burst(at.col, at.row, { count: 12, reach: 4, life: 0.5, color: 'red' });
    }
    if (this.variant === 'C') this.sparks.burst(at.col, at.row, { count: 8, reach: 3, life: 0.3, color: 'yellow' });
    if (this.variant === 'D') {
      this.sparks.burst(at.col, at.row, { count: 14, reach: 5, life: 0.5, color: 'yellow' });
      this.burstDebris(side);
    }
  }

  // ------------------------------------------------------------------ A: smoke + sparks

  private puffs: { col: number; row: number; vc: number; vr: number; age: number; ember: boolean }[] = [];
  private puffSpawn = 0;
  private spitIn = 1;

  private smokeAndSparks(dt: number, text: TextGrid) {
    // Sources on the console tops; the right console joins at 1 Life.
    const spots: [number, number, number][] = this.level >= 1 ? [[0, 0.22, 0.2], [0, -0.22, 0.2]] : [];
    if (this.level >= 2) spots.push([1, 0.2, 0.2], [1, -0.25, 0.2], [0, 0, 0.2]);
    const rate = (this.level === 1 ? 22 : this.level === 2 ? 60 : 0) * PLAYER_DAMAGE_PROTO.amount;
    this.puffSpawn += rate * dt;
    while (this.puffSpawn >= 1 && spots.length) {
      this.puffSpawn -= 1;
      const [i, x, y] = spots[Math.floor(Math.random() * spots.length)];
      const s = this.onPanel(i, x + (Math.random() - 0.5) * 0.1, y);
      // Smoke leans outward, away from the yoke and the words in the middle.
      const out = i === 0 ? -1 : 1;
      this.puffs.push({ col: s.col, row: s.row, vc: out * (0.5 + Math.random() * 1.5), vr: -(3 + Math.random() * 3), age: 0, ember: this.level >= 2 && Math.random() < 0.25 });
    }
    if (!spots.length) this.puffSpawn = 0;
    const life = 2.8;
    const SMOKE = '@#*:~-,.';
    for (let k = this.puffs.length - 1; k >= 0; k--) {
      const f = this.puffs[k];
      f.age += dt;
      if (f.age >= life) {
        this.puffs.splice(k, 1);
        continue;
      }
      f.col += f.vc * dt;
      f.row += f.vr * dt;
      const glyph = SMOKE[Math.min(SMOKE.length - 1, Math.floor((f.age / life) * SMOKE.length))];
      text.write(Math.floor(f.col), Math.floor(f.row), glyph, f.ember && f.age < 0.4 ? 'red' : f.age < life * 0.3 ? 'fg' : 'dim');
    }
    // Sparks spit from a console now and then.
    if (this.level >= 1 && (this.spitIn -= dt) <= 0) {
      this.spitIn = this.level === 1 ? 1.8 + Math.random() * 2 : 0.4 + Math.random() * 0.8;
      const [i, x, y] = spots[Math.floor(Math.random() * spots.length)];
      const s = this.onPanel(i, x, y - 0.1);
      this.sparks.burst(s.col, s.row, { count: 5, reach: 2.5, life: 0.3, color: Math.random() < 0.3 ? 'red' : 'yellow', aim: Math.PI / 2, spread: 1 });
    }
  }

  // ------------------------------------------------------------------ B: cracked glass

  /** Crack cells per level, in the order they spread (nearest the origin first). */
  private crackCells: { col: number; row: number; ch: string; level: number; d: number }[] = [];

  private buildCracks() {
    const rnd = mulberry(7);
    const add = (level: number, c0: number, r0: number, c1: number, r1: number, d0: number) => {
      const n = Math.ceil(Math.max(Math.abs(c1 - c0), Math.abs(r1 - r0) * 2));
      const slope = (r1 - r0) / ((c1 - c0) / 2 || 0.001); // in cell-aspect terms
      const ch = Math.abs(slope) < 0.4 ? '-' : Math.abs(slope) > 2.5 ? '|' : slope * Math.sign(c1 - c0) > 0 ? '\\' : '/';
      for (let k = 0; k <= n; k++) {
        const col = Math.round(c0 + ((c1 - c0) * k) / n);
        const row = Math.round(r0 + ((r1 - r0) * k) / n);
        this.crackCells.push({ col, row, ch, level, d: d0 + k });
      }
      return d0 + n;
    };
    /** A jagged crack from (c, r) heading `angle` (0 = right, π/2 = down in grid terms), with branches. */
    const crack = (level: number, c: number, r: number, angle: number, length: number, d: number, depth: number) => {
      let left = length;
      while (left > 0) {
        const step = 3 + rnd() * 5;
        angle += (rnd() - 0.5) * 0.9;
        const c1 = c + Math.cos(angle) * step * 2;
        const r1 = r + Math.sin(angle) * step;
        // Keep the middle bottom clear: the Typed word, the Attack word and incoming words live there.
        if (r1 > 24 && c1 > 16 && c1 < COLS - 16) break;
        d = add(level, c, r, c1, r1, d);
        if (depth < 2 && rnd() < 0.3) crack(level, c1, r1, angle + (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 0.6), left * 0.5, d, depth + 1);
        c = c1;
        r = r1;
        left -= step;
      }
    };
    // 2 Lives: one crack system from the top-left corner.
    crack(1, 4, 2, 0.5, 34, 0, 0);
    crack(1, 4, 2, 1.2, 22, 0, 0);
    // 1 Life: an impact star high on the right, and a crack down the left edge.
    const ic = 98, ir = 9;
    for (let k = 0; k < 9; k++) crack(2, ic, ir, (k / 9) * Math.PI * 2 + rnd() * 0.3, 8 + rnd() * 10, 0, 1);
    crack(2, 2, 12, 1.4, 24, 0, 0);
    this.crackCells.push({ col: ic, row: ir, ch: '*', level: 2, d: 0 });
  }

  private cracks(text: TextGrid) {
    const spread = this.sinceMark * 90; // cells per second as a new crack runs
    for (const c of this.crackCells) {
      if (c.level > this.level) continue;
      const fresh = c.level === this.level && this.sinceMark < 3;
      if (fresh && c.d > spread) continue;
      const glint = fresh && this.sinceMark < 0.5 + c.d / 90;
      text.write(c.col, c.row, c.ch, c.ch === '*' ? 'fg' : glint ? 'fg' : 'dim');
    }
  }

  // ------------------------------------------------------------------ C: failing systems

  private glitchLeft = 0;
  private glitchIn = 2;

  private failing(dt: number) {
    const p = this.cockpit.protoParts;
    const noise = (k: number) => Math.sin(this.t * 31 + k * 7) * Math.sin(this.t * 17.3 + k * 3);
    // Panels: brief dark dips; at 1 Life both panels and longer. Right after the Life goes, a full blackout.
    p.panelMats.forEach((m, i) => {
      const affected = this.level >= 2 || (this.level === 1 && i === 0);
      const dip = affected && noise(i) > (this.level >= 2 ? 0.55 : 0.75);
      const blackout = this.sinceMark < 0.45 && Math.floor(this.sinceMark * 20) % 3 !== 0;
      if (dip || blackout) m.color.multiplyScalar(0.25);
    });
    // Dead switches: some go out for good (indices 0-4 on the Lives console, 5-9 on the Radar one).
    const dead = this.level === 1 ? [1, 3] : this.level === 2 ? [1, 3, 7, 9, 5] : [];
    dead.forEach((k) => (p.switches[k].visible = false));
    // The ATTACK label stutters at 1 Life (never the Attack word).
    if (this.level >= 2) this.cockpit.protoLabelOff = noise(5) > 0.6;
    // Small constant tremble at 1 Life.
    if (this.level >= 2) {
      this.camera.position.x += Math.sin(this.t * 53) * 0.004;
      this.camera.position.y += Math.sin(this.t * 61 + 1) * 0.004;
    }
    // Radar glitches: rare at 2 Lives, often at 1, and always right after the Life goes.
    if (this.sinceMark < 0.6) this.glitchLeft = Math.max(this.glitchLeft, 0.6 - this.sinceMark);
    this.glitchLeft = Math.max(0, this.glitchLeft - dt);
    if (this.level >= 1 && (this.glitchIn -= dt) <= 0) {
      this.glitchIn = this.level === 1 ? 3 + Math.random() * 3 : 0.8 + Math.random() * 1.2;
      this.glitchLeft = this.level === 1 ? 0.2 : 0.35;
    }
  }

  private radarGlitch(text: TextGrid) {
    const p = this.cockpit.protoParts;
    // Warning text on the Lives console, under the lamps.
    if (this.level >= 1) {
      const at = this.onPanel(0, 0.02, 0.15); // between the lamps and the LIVES label
      const msg = this.level === 1 ? 'HULL DAMAGED' : '!! HULL CRITICAL !!';
      const on = this.level === 1 || Math.floor(this.t * 3) % 2 === 0;
      if (on) text.write(Math.round(at.col - msg.length / 2), Math.round(at.row), msg, this.level === 1 ? 'yellow' : 'red');
    }
    if (this.glitchLeft <= 0 || !p.radarScreen) return;
    const r = gridRectOf(p.radarScreen, this.camera, true);
    const G = '#%$&@=+:';
    for (let row = r.r0; row <= r.r1; row++) {
      const tear = Math.random() < 0.35;
      for (let col = r.c0; col <= r.c1; col++) {
        if (tear || Math.random() < 0.25) text.write(col, row, tear ? '=' : G[Math.floor(Math.random() * G.length)], Math.random() < 0.2 ? 'green' : 'dim');
      }
    }
  }

  // ------------------------------------------------------------------ D: broken structure

  private cableA: THREE.Mesh[] = [];
  private cableB: THREE.Mesh[] = [];
  private debris: { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; life: number; level: number }[] = [];
  private jolt = 0;
  private readonly metal = new THREE.MeshLambertMaterial({ color: new THREE.Color(0.85, 0.85, 0.85) });
  private readonly wire = new THREE.MeshBasicMaterial({ color: ASCII_STYLE.palette.red });

  private buildStructure() {
    const seg = (r: number) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.06, 6), this.wire);
    // A: hangs over the Lives console; B: drops from the top of the window at 1 Life.
    for (let k = 0; k < 6; k++) this.cableA.push(seg(0.02));
    for (let k = 0; k < 9; k++) this.cableB.push(seg(0.012));
    this.cableA.forEach((m) => this.cockpit.protoParts.panels[0].add(m));
    this.cableB.forEach((m) => this.cockpit.protoParts.root.add(m));
    // Debris floating in the cockpit, kept to the sides.
    const rnd = mulberry(3);
    for (let k = 0; k < 10; k++) {
      const s = 0.02 + rnd() * 0.035;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(s, s * (0.5 + rnd()), s), this.metal);
      const side = k % 2 ? 1 : -1;
      mesh.position.set(side * (0.55 + rnd() * 0.4), -0.1 + rnd() * 0.5, -1.3 - rnd() * 0.5);
      mesh.visible = false;
      this.cockpit.protoParts.root.add(mesh);
      this.debris.push({ mesh, vel: new THREE.Vector3((rnd() - 0.5) * 0.02, (rnd() - 0.5) * 0.02, 0), spin: new THREE.Vector3(rnd(), rnd(), rnd()).multiplyScalar(1.5), life: Infinity, level: k < 4 ? 1 : 2 });
    }
  }

  /** A swinging chain: from `top`, each segment hangs a little more bent than the last. */
  private swing(segs: THREE.Mesh[], top: THREE.Vector3, phase: number, amp: number) {
    const p = top.clone();
    segs.forEach((m, k) => {
      const a = Math.sin(this.t * 1.7 + phase - k * 0.25) * amp * (1 + k * 0.12) + this.jolt * 0.5 * Math.sin(this.t * 9);
      const dx = Math.sin(a) * 0.06;
      const dy = -Math.cos(a) * 0.06;
      m.position.set(p.x + dx / 2, p.y + dy / 2, p.z);
      m.rotation.set(0, 0, a);
      p.x += dx;
      p.y += dy;
    });
  }

  private structure(dt: number) {
    const p = this.cockpit.protoParts;
    this.jolt = Math.max(0, this.sinceMark < 0.6 ? 1 - this.sinceMark / 0.6 : 0);
    const shake = this.jolt * Math.sin(this.t * 40) * 0.05;
    if (this.level >= 1) {
      // The Lives console is knocked loose: tilted, dropped, two switches gone.
      const g = p.panels[0];
      g.rotation.z += 0.14 + shake;
      g.rotation.x += 0.12;
      g.position.y -= 0.035;
      p.switches[1].visible = false;
      p.switches[3].visible = false;
    }
    if (this.level >= 2) {
      const g = p.panels[1];
      g.rotation.z -= 0.1 - shake;
      g.rotation.x += 0.1;
      g.position.y -= 0.025;
      p.switches[6].visible = false;
      p.switches[9].visible = false;
    }
    this.cableA.forEach((m) => (m.visible = this.level >= 1));
    this.cableB.forEach((m) => (m.visible = this.level >= 2));
    if (this.level >= 1) this.swing(this.cableA, new THREE.Vector3(0.24, 0.2, 0.08), 0, 0.25);
    if (this.level >= 2) this.swing(this.cableB, new THREE.Vector3(-0.68, 0.6, -1.5), 1, 0.18);
    for (let k = this.debris.length - 1; k >= 0; k--) {
      const d = this.debris[k];
      d.mesh.visible = d.level <= this.level;
      if (!d.mesh.visible) continue;
      d.life -= dt;
      if (d.life <= 0) {
        d.mesh.removeFromParent();
        d.mesh.geometry.dispose();
        this.debris.splice(k, 1);
        continue;
      }
      d.mesh.position.addScaledVector(d.vel, dt);
      // Drift back toward the sides if a piece wanders toward the middle.
      if (Math.abs(d.mesh.position.x) < 0.5) d.vel.x += Math.sign(d.mesh.position.x || 1) * dt * 0.2;
      d.mesh.position.y += Math.sin(this.t * 0.8 + k) * 0.0008;
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.y += d.spin.y * dt;
      d.mesh.rotation.z += d.spin.z * dt;
    }
  }

  /** The Life goes: a handful of pieces fly off the console that broke, then fade. */
  private burstDebris(side: number) {
    const g = this.cockpit.protoParts.panels[side];
    for (let k = 0; k < 8; k++) {
      const s = 0.015 + Math.random() * 0.025;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), this.metal);
      g.updateWorldMatrix(true, false);
      const at = g.localToWorld(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.15, 0.06));
      this.cockpit.protoParts.root.worldToLocal(at);
      mesh.position.copy(at);
      this.cockpit.protoParts.root.add(mesh);
      const out = side === 0 ? -1 : 1;
      this.debris.push({ mesh, vel: new THREE.Vector3(out * (0.2 + Math.random() * 0.4), 0.2 + Math.random() * 0.4, 0.3 + Math.random() * 0.3), spin: new THREE.Vector3(5, 7, 3), life: 1.5, level: 0 });
    }
  }

  dispose() {
    this.metal.dispose();
    this.wire.dispose();
    void this.scene;
  }
}
