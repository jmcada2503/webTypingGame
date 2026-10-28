import * as THREE from 'three';
import type { TextGrid } from '../../render/AsciiRenderer';
import { ASCII_STYLE } from '../../render/asciiStyle';
import type { EnemyShip } from '../enemy/EnemyShip';

/** Live-tunable from the sandbox panel. */
export const DAMAGE_LOOK = {
  /** Smoke multiplier (puffs per second = damage × 18 × smoke). */
  smoke: 3,
  /** Damage at which the left wing loses its tip. */
  wingTipAt: 0.4,
  /** Damage at which the right engine is gone and the right wing is shortened. */
  engineAt: 0.75,
};

/** Smoke sources in the ship model's local space (see EnemyShip): engine backs, wing roots. */
const SPOTS = {
  engineL: new THREE.Vector3(-1.1, 0.4, -2.6),
  engineR: new THREE.Vector3(1.1, 0.4, -2.6),
  wingL: new THREE.Vector3(-2.2, 0.1, 0.4),
  wingR: new THREE.Vector3(2.2, 0.1, 0.4),
};
type SpotName = keyof typeof SPOTS;

/** Smoke glyphs from fresh (dense) to old (thin). */
const SMOKE = '@#*:~-,.';
const SMOKE_LIFE = 1.4; // s
const SMOKE_RISE = 4; // grid rows / s
const SMOKE_SPREAD = 1.2; // grid columns / s

type Puff = { col: number; row: number; vc: number; vr: number; age: number };
const tmp = new THREE.Vector3();

/**
 * Damaged Enemy ship ("Juice: Damaged Enemy ship"), driven by `enemyDamage` (0..1):
 * - **smoke:** dim grid glyphs trail up from the ship, thicker with damage; more sources as it
 *   breaks (left engine → + left wing → all engines and wings);
 * - **missing pieces:** past `wingTipAt` the left wing loses its tip; past `engineAt` the right
 *   engine is gone and the right wing is shortened.
 */
export class EnemyDamageFx {
  private puffs: Puff[] = [];
  private spawn = 0;

  constructor(
    private readonly enemy: EnemyShip,
    private readonly camera: THREE.PerspectiveCamera,
  ) {}

  /** Call every frame after the ship's own update and before the Cockpit draws. */
  update(damage: number, dt: number, text: TextGrid) {
    const p = this.enemy.parts;
    // Intact shape first, then break what this damage level breaks.
    p.wingL.scale.set(-1, 1, 1);
    p.wingR.scale.set(1, 1, 1);
    p.engineR.visible = true;
    if (damage >= DAMAGE_LOOK.wingTipAt) p.wingL.scale.set(-0.6, 1, 1);
    if (damage >= DAMAGE_LOOK.engineAt) {
      p.engineR.visible = false;
      p.wingR.scale.set(0.7, 1, 1);
    }

    const sources: SpotName[] =
      damage >= DAMAGE_LOOK.engineAt ? ['engineL', 'engineR', 'wingL', 'wingR'] : damage >= DAMAGE_LOOK.wingTipAt ? ['engineL', 'wingL'] : ['engineL'];
    this.spawn += damage * 18 * DAMAGE_LOOK.smoke * dt;
    while (this.spawn >= 1) {
      this.spawn -= 1;
      if (damage <= 0) break;
      const s = this.spot(sources[Math.floor(Math.random() * sources.length)]);
      this.puffs.push({
        col: s.col + (Math.random() * 2 - 1) * 0.8,
        row: s.row,
        vc: (Math.random() * 2 - 1) * SMOKE_SPREAD,
        vr: -SMOKE_RISE * (0.6 + Math.random() * 0.8),
        age: 0,
      });
    }
    if (damage <= 0) this.spawn = 0;

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
      text.write(Math.floor(f.col), Math.floor(f.row), glyph, 'dim');
    }
  }

  /** Grid position of a smoke source right now (follows the ship's motion). */
  private spot(name: SpotName) {
    const { cols, rows } = ASCII_STYLE.grid;
    const model = this.enemy.parts.hull.parent!;
    model.updateWorldMatrix(true, false);
    tmp.copy(SPOTS[name]).applyMatrix4(model.matrixWorld).project(this.camera);
    return { col: ((tmp.x + 1) / 2) * cols, row: ((1 - tmp.y) / 2) * rows };
  }

  dispose() {
    this.puffs = [];
  }
}
