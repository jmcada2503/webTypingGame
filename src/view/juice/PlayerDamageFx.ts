import * as THREE from 'three';
import type { TextGrid } from '../../render/AsciiRenderer';
import type { CockpitDamageParts } from '../cockpit/Cockpit';
import { gridRectOf, worldToGrid } from '../cockpit/gridProjection';
import { DAMAGE_LEVELS, damageLevel, markConsole, markedLevel, trembleAmplitude, type Console } from './playerDamage';
import type { SparkBursts } from './SparkBursts';

/** Live-tunable from the sandbox panel. */
export const PLAYER_DAMAGE_LOOK = {
  /** Smoke multiplier (puffs per second = the level's rate × smoke). */
  smoke: 1,
  /** Steady tremble multiplier. */
  tremble: 1,
  /** The jolt when a Life goes: strength (world units) and how long it takes to fade (s). */
  jolt: 0.05,
  joltSeconds: 0.7,
  /** Consoles black out this long (s) when a Life goes. */
  blackoutSeconds: 0.45,
};

/** Smoke glyphs from fresh (dense) to old (thin). */
const SMOKE = '@#*:~-,.';
const SMOKE_LIFE = 2.8; // s
/** Smoke rises (grid rows / s) and leans outward, away from the middle (grid columns / s). */
const SMOKE_RISE: [number, number] = [3, 6];
const SMOKE_LEAN: [number, number] = [0.5, 2];
const GLITCH_GLYPHS = '#%$&@=+:';
/** The Radar glitches this long (s) right after a Life goes. */
const MARK_GLITCH_SECONDS = 0.6;

/** Smoke sources on each console, in its local space (the top edge, either side of the middle). */
const SMOKE_SPOTS: Record<Console, [number, number][]> = {
  lives: [[0.22, 0.2], [-0.22, 0.2], [0, 0.2]],
  radar: [[0.2, 0.2], [-0.25, 0.2]],
};

type Puff = { col: number; row: number; vc: number; vr: number; age: number; ember: boolean };
type Rest = { obj: THREE.Object3D; pos: THREE.Vector3; rot: THREE.Euler };

const between = ([a, b]: [number, number]) => a + Math.random() * (b - a);
const tmp = new THREE.Vector3();

/**
 * Player damage ("Prototype: Player damage", variant E), driven by `lives`: the Cockpit wears its damage on the
 * side consoles and the structure below the Typed word screen.
 * - **smoke** rises from the consoles and leans outward; **sparks** spit now and then;
 * - **failing systems:** the consoles flicker dark, switches die, a HULL warning sits on the Lives console, the
 *   Radar glitches;
 * - **tremble:** the consoles (their labels stutter at 1 Life), the yoke column, bar and grips;
 * - **when a Life goes:** a spark burst from the console that broke, a console blackout, a Radar glitch and a hard
 *   jolt of that structure.
 * The Typed word screen and everything above it never move: the Attack word and the Typed word stay readable.
 * Damage stays until the Match ends; 0 Lives keeps the 1-Life look while the Lose ending plays.
 */
export class PlayerDamageFx {
  private t = 0;
  private lastLives = 3;
  /** Seconds since the last new damage level. */
  private sinceMark = Infinity;
  private puffs: Puff[] = [];
  private spawn = 0;
  private spitIn = 0;
  private glitchIn = 0;
  private glitchLeft = 0;
  private readonly rest: Rest[];
  private readonly bodyColors: Record<Console, THREE.Color>;

  constructor(
    private readonly parts: CockpitDamageParts,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly sparks: SparkBursts,
  ) {
    const { lives, radar } = parts.consoles;
    this.rest = [lives.group, radar.group, ...parts.yoke].map((obj) => ({ obj, pos: obj.position.clone(), rot: obj.rotation.clone() }));
    this.bodyColors = { lives: lives.body.color.clone(), radar: radar.body.color.clone() };
  }

  /** Call every frame after the camera shake and before the Cockpit draws (its text goes over the smoke). */
  update(lives: number, dt: number, text: TextGrid) {
    this.t += dt;
    this.sinceMark += dt;
    const marked = markedLevel(this.lastLives, lives);
    if (lives > this.lastLives) this.sinceMark = Infinity; // Lives back up (a new Match, the sandbox)
    this.lastLives = lives;
    const level = damageLevel(lives);
    this.restore();
    if (marked) this.mark(marked);
    if (level === 0) {
      this.puffs = [];
      return;
    }
    this.smoke(level, dt, text);
    this.failingSystems(level, dt);
    this.tremble(level);
  }

  /** Call after the Cockpit draws: the warning and the Radar glitch go over its readouts. */
  drawAfter(text: TextGrid) {
    const level = damageLevel(this.lastLives);
    if (level === 0) return;
    const { warning } = DAMAGE_LEVELS[level];
    if (warning.blinkHz === 0 || Math.floor(this.t * warning.blinkHz * 2) % 2 === 0) {
      const at = this.onConsole('lives', 0.02, 0.15); // between the lamps and the LIVES label
      text.write(Math.round(at.col - warning.text.length / 2), Math.round(at.row), warning.text, warning.color);
    }
    if (this.glitchLeft > 0) this.radarGlitch(text);
  }

  /** Back to the resting Cockpit before this frame's damage is applied. */
  private restore() {
    for (const r of this.rest) {
      r.obj.position.copy(r.pos);
      r.obj.rotation.copy(r.rot);
    }
    for (const c of ['lives', 'radar'] as const) {
      const part = this.parts.consoles[c];
      part.body.color.copy(this.bodyColors[c]);
      part.switches.forEach((s) => (s.visible = true));
      part.label.visible = true;
    }
  }

  /** Grid position of a point on a console, in its local space. */
  private onConsole(c: Console, x: number, y: number) {
    const g = this.parts.consoles[c].group;
    g.updateWorldMatrix(true, false);
    return worldToGrid(g.localToWorld(tmp.set(x, y, 0.05)), this.camera);
  }

  /** A new level of damage, the moment the Life goes. */
  private mark(level: 1 | 2) {
    this.sinceMark = 0;
    const c = markConsole(level);
    const at = this.onConsole(c, c === 'lives' ? 0.15 : -0.2, 0.15);
    this.sparks.burst(at.col, at.row, { count: 22, reach: 6, life: 0.6, color: 'yellow' });
    this.sparks.burst(at.col, at.row, { count: 12, reach: 4, life: 0.5, color: 'red' });
    this.glitchLeft = Math.max(this.glitchLeft, MARK_GLITCH_SECONDS);
  }

  private smoke(level: 1 | 2, dt: number, text: TextGrid) {
    const s = DAMAGE_LEVELS[level];
    this.spawn += s.smokePerSecond * PLAYER_DAMAGE_LOOK.smoke * dt;
    while (this.spawn >= 1) {
      this.spawn -= 1;
      const c = s.smokeFrom[Math.floor(Math.random() * s.smokeFrom.length)];
      const spots = SMOKE_SPOTS[c];
      const [x, y] = spots[Math.floor(Math.random() * spots.length)];
      const at = this.onConsole(c, x + (Math.random() - 0.5) * 0.1, y);
      const out = c === 'lives' ? -1 : 1;
      this.puffs.push({ col: at.col, row: at.row, vc: out * between(SMOKE_LEAN), vr: -between(SMOKE_RISE), age: 0, ember: Math.random() < s.embers });
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const f = this.puffs[i];
      f.age += dt;
      if (f.age >= SMOKE_LIFE) {
        this.puffs.splice(i, 1);
        continue;
      }
      f.col += f.vc * dt;
      f.row += f.vr * dt;
      const glyph = SMOKE[Math.min(SMOKE.length - 1, Math.floor((f.age / SMOKE_LIFE) * SMOKE.length))];
      text.write(Math.floor(f.col), Math.floor(f.row), glyph, f.ember && f.age < 0.4 ? 'red' : f.age < SMOKE_LIFE * 0.3 ? 'fg' : 'dim');
    }
    if ((this.spitIn -= dt) <= 0) {
      this.spitIn = between(s.sparkEvery);
      const c = s.smokeFrom[Math.floor(Math.random() * s.smokeFrom.length)];
      const [x, y] = SMOKE_SPOTS[c][Math.floor(Math.random() * SMOKE_SPOTS[c].length)];
      const at = this.onConsole(c, x, y - 0.1);
      this.sparks.burst(at.col, at.row, { count: 5, reach: 2.5, life: 0.3, color: Math.random() < 0.3 ? 'red' : 'yellow', aim: Math.PI / 2, spread: 1 });
    }
  }

  private failingSystems(level: 1 | 2, dt: number) {
    const s = DAMAGE_LEVELS[level];
    const noise = (k: number) => Math.sin(this.t * 31 + k * 7) * Math.sin(this.t * 17.3 + k * 3);
    const blackout = this.sinceMark < PLAYER_DAMAGE_LOOK.blackoutSeconds && Math.floor(this.sinceMark * 20) % 3 !== 0;
    (['lives', 'radar'] as const).forEach((c, i) => {
      const part = this.parts.consoles[c];
      if (blackout || (s.flicker.includes(c) && noise(i) > s.flickerAbove)) part.body.color.multiplyScalar(0.25);
      s.deadSwitches[c].forEach((k) => (part.switches[k].visible = false));
    });
    this.glitchLeft = Math.max(0, this.glitchLeft - dt);
    if ((this.glitchIn -= dt) <= 0) {
      this.glitchIn = between(s.glitchEvery);
      this.glitchLeft = Math.max(this.glitchLeft, s.glitchSeconds);
    }
  }

  /** The consoles and the yoke shake; the labels stutter at 1 Life and while the jolt runs. */
  private tremble(level: 1 | 2) {
    const amp = trembleAmplitude(level, this.sinceMark, PLAYER_DAMAGE_LOOK);
    if (amp <= 0) return;
    const wobble = (k: number) => Math.sin(this.t * 47 + k * 2.1) * Math.sin(this.t * 13 + k);
    const [livesRest, radarRest, ...yoke] = this.rest;
    [livesRest, radarRest].forEach((r, i) => {
      r.obj.position.x += wobble(i) * amp;
      r.obj.position.y += wobble(i + 3) * amp;
      r.obj.rotation.z += wobble(i + 6) * amp * 2;
    });
    // Column and bar sway; the grips beside the Typed word screen shake on their own (the screen does not).
    yoke.forEach((r, i) => {
      r.obj.position.x += wobble(i + 9) * amp * 0.6;
      if (i >= 2) {
        r.obj.position.y += wobble(i + 14) * amp * 0.4;
        r.obj.rotation.z += wobble(i + 18) * amp * 1.5;
      }
    });
    const jolting = this.sinceMark < PLAYER_DAMAGE_LOOK.joltSeconds * 0.5;
    if (DAMAGE_LEVELS[level].labelsStutter || jolting) {
      this.parts.consoles.lives.label.visible = wobble(12) < 0.55;
      this.parts.consoles.radar.label.visible = wobble(13) < 0.55;
    }
  }

  private radarGlitch(text: TextGrid) {
    const r = gridRectOf(this.parts.radarScreen, this.camera, true);
    for (let row = r.r0; row <= r.r1; row++) {
      const tear = Math.random() < 0.35;
      for (let col = r.c0; col <= r.c1; col++) {
        if (tear || Math.random() < 0.25) text.write(col, row, tear ? '=' : GLITCH_GLYPHS[Math.floor(Math.random() * GLITCH_GLYPHS.length)], Math.random() < 0.2 ? 'green' : 'dim');
      }
    }
  }

  dispose() {
    this.puffs = [];
    this.restore();
  }
}
