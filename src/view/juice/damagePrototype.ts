// PROTOTYPE ("Juice: Damaged Enemy ship"): how enemyDamage (0..1) shows on the dart, ?variant=A..C.
// Smoke / fire are grid glyphs drawn at points on the hull (projected each frame); broken parts are
// the ship's own meshes hidden, shortened or drooped. Throwaway.
import * as THREE from 'three';
import type { PaletteColor, TextGrid } from '../../render/AsciiRenderer';
import { ASCII_STYLE } from '../../render/asciiStyle';
import type { EnemyShip } from '../enemy/EnemyShip';

export const DAMAGE_VARIANTS = [
  { key: 'A', name: 'Smoke trail + pieces missing at 40% / 75%' },
  { key: 'B', name: 'Red fire on the hull + flicker, ship intact' },
  { key: 'C', name: 'Broken: drooping wing, hanging engine, wobble, red sparks' },
];
export type DamageKind = 'A' | 'B' | 'C';

/** Live-tunable from the sandbox panel. */
export const DAMAGE_PROTO = { kind: 'A' as DamageKind, smoke: 1 };

/** Damage spots in the ship model's local space (see EnemyShip): engine backs, wing roots / tips, hull. */
const SPOTS = {
  engineL: new THREE.Vector3(-1.1, 0.4, -2.6),
  engineR: new THREE.Vector3(1.1, 0.4, -2.6),
  wingL: new THREE.Vector3(-2.2, 0.1, 0.4),
  wingR: new THREE.Vector3(2.2, 0.1, 0.4),
  hull: new THREE.Vector3(0, 0.6, -0.6),
};
type SpotName = keyof typeof SPOTS;

type Puff = { col: number; row: number; vc: number; vr: number; age: number; life: number; color: PaletteColor; glyphs: string };

const tmp = new THREE.Vector3();

export class DamageFx {
  private t = 0;
  private puffs: Puff[] = [];
  private spawn = 0;
  private spark = 0;

  constructor(
    private readonly enemy: EnemyShip,
    private readonly camera: THREE.PerspectiveCamera,
  ) {}

  /** Grid position of a damage spot right now. */
  private spot(name: SpotName) {
    const { cols, rows } = ASCII_STYLE.grid;
    const model = this.enemy.parts.hull.parent!;
    model.updateWorldMatrix(true, false);
    tmp.copy(SPOTS[name]).applyMatrix4(model.matrixWorld).project(this.camera);
    return { col: ((tmp.x + 1) / 2) * cols, row: ((1 - tmp.y) / 2) * rows };
  }

  /** Put every part back to its intact shape (variants then break what they need). */
  private resetParts() {
    const p = this.enemy.parts;
    for (const k of ['hull', 'wingL', 'wingR', 'engineL', 'engineR'] as const) p[k].visible = true;
    p.wingL.scale.set(-1, 1, 1);
    p.wingR.scale.set(1, 1, 1);
    p.wingL.rotation.set(-Math.PI / 2, 0, 0);
    p.wingR.rotation.set(-Math.PI / 2, 0, 0);
    p.engineL.position.set(-1.1, 0.2, -1.6);
    p.engineR.position.set(1.1, 0.2, -1.6);
    p.engineR.rotation.set(Math.PI / 2, 0, 0);
    this.enemy.effectRoll = 0;
    this.enemy.material.color.setRGB(1, 1, 1);
  }

  private emit(name: SpotName, color: PaletteColor, glyphs: string, rise: number, spread: number, life: number) {
    const s = this.spot(name);
    this.puffs.push({
      col: s.col + (Math.random() * 2 - 1) * 0.8,
      row: s.row,
      vc: (Math.random() * 2 - 1) * spread,
      vr: -rise * (0.6 + Math.random() * 0.8),
      age: 0,
      life,
      color,
      glyphs,
    });
  }

  /** Call every frame (after the ship's own update, before the Cockpit draws). */
  update(damage: number, dt: number, text: TextGrid) {
    this.t += dt;
    this.resetParts();
    const kind = DAMAGE_PROTO.kind;
    const p = this.enemy.parts;
    const smokeRate = damage * 18 * DAMAGE_PROTO.smoke; // puffs per second

    if (kind === 'A') {
      if (damage >= 0.4) p.wingL.scale.set(-0.6, 1, 1); // left wing tip blown off
      if (damage >= 0.75) {
        p.engineR.visible = false;
        p.wingR.scale.set(0.7, 1, 1);
      }
      this.spawn += smokeRate * dt;
      const sources: SpotName[] = damage >= 0.75 ? ['engineL', 'engineR', 'wingL', 'wingR'] : damage >= 0.4 ? ['engineL', 'wingL'] : ['engineL'];
      while (this.spawn >= 1 && damage > 0) {
        this.spawn -= 1;
        this.emit(sources[Math.floor(Math.random() * sources.length)], 'dim', '@#*:~-,.', 4, 1.2, 1.4);
      }
    } else if (kind === 'B') {
      // Fire: flickering red glyphs at more spots as damage grows; a little smoke above.
      const spots: SpotName[] = ['engineL', 'wingR', 'hull', 'engineR', 'wingL'];
      const burning = Math.ceil(damage * spots.length);
      for (let i = 0; i < burning; i++) {
        const s = this.spot(spots[i]);
        for (let j = 0; j < 3; j++) {
          const flick = Math.sin(this.t * 23 + i * 7 + j * 3);
          if (flick < -0.2) continue;
          const ch = '^*!^'[(Math.floor(this.t * 12) + i + j) % 4];
          text.write(Math.floor(s.col + j - 1), Math.floor(s.row - (flick > 0.6 ? 1 : 0)), ch, 'red');
        }
      }
      this.spawn += smokeRate * 0.4 * dt;
      while (this.spawn >= 1 && damage > 0) {
        this.spawn -= 1;
        this.emit(spots[Math.floor(Math.random() * burning)], 'dim', ':~-,.', 3, 0.8, 1.1);
      }
      if (damage > 0.6) {
        const dim = 0.55 + 0.45 * (Math.sin(this.t * 31) > 0.2 ? 1 : 0.4);
        this.enemy.material.color.setRGB(dim, dim, dim);
      }
    } else {
      // Broken: wing droops, engine hangs, wobble grows; occasional red spark bursts.
      if (damage >= 0.35) p.wingL.rotation.set(-Math.PI / 2, 0.45 * Math.min(1, (damage - 0.35) / 0.3), 0);
      if (damage >= 0.65) {
        p.engineR.position.set(1.25, -0.25, -1.75);
        p.engineR.rotation.set(Math.PI / 2 + 0.5, 0, 0.25);
      }
      this.enemy.effectRoll = Math.sin(this.t * 5) * 0.18 * damage + Math.sin(this.t * 13) * 0.04 * damage;
      this.spark -= dt;
      if (damage > 0.2 && this.spark <= 0) {
        this.spark = 0.4 + Math.random() * (1.4 - damage);
        const at: SpotName = Math.random() < 0.5 ? 'wingL' : 'engineR';
        for (let i = 0; i < 6; i++) this.emit(at, 'red', '*+.', 6, 5, 0.35);
      }
      this.spawn += smokeRate * 0.6 * dt;
      while (this.spawn >= 1 && damage > 0) {
        this.spawn -= 1;
        this.emit(damage >= 0.65 ? 'engineR' : 'engineL', 'dim', '#*:~-.', 4, 1, 1.2);
      }
    }

    // Puffs: drift (smoke rises and spreads), age through their glyph sequence, then go.
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const f = this.puffs[i];
      f.age += dt;
      if (f.age >= f.life) {
        this.puffs.splice(i, 1);
        continue;
      }
      f.col += f.vc * dt;
      f.row += f.vr * dt;
      const k = f.age / f.life;
      text.write(Math.floor(f.col), Math.floor(f.row), f.glyphs[Math.min(f.glyphs.length - 1, Math.floor(k * f.glyphs.length))], f.color);
    }
  }

  dispose() {
    this.resetParts();
    this.puffs = [];
  }
}
