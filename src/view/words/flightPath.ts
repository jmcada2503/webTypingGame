import * as THREE from 'three';
import type { GameViewState, WordBulletState } from '../GameViewState';

/**
 * Where Word bullets fly, in world units (camera at z = 7 looking at -z). Live-tunable from the
 * sandbox panel; "Word bullets in flight" decides the final path, curve and speeds.
 */
export const WORD_FLIGHT = {
  /** Leaving the Enemy ship (Flight 0). */
  start: { y: 6, z: -25 },
  /**
   * Bullets leave from the ship's wings: alternately x = -muzzleX (left) and +muzzleX (right),
   * one after the other in firing order. 0 = all from the center.
   */
  muzzleX: 0,
  /** Reaching the Cockpit (Flight 1). */
  end: { y: -1.1, z: 2.5 },
  /** World x between lanes at Flight 1 (lanes fan out from the Enemy ship). */
  laneSpread: 1.3,
};

/** Lane order: center first, then alternating outwards. */
const LANES = [0, -1, 1, -2, 2];

/**
 * Each Word bullet gets, once, a lane (least used, center first) and a launch wing
 * (alternating left / right in firing order), and keeps both for its whole flight.
 */
export class WordBulletTracks {
  private readonly lanes = new Map<string, number>();
  private readonly sides = new Map<string, -1 | 1>();
  private nextSide: -1 | 1 = -1;

  update(state: GameViewState) {
    const alive = new Set(state.wordBullets.map((b) => b.id));
    for (const id of this.lanes.keys()) {
      if (alive.has(id)) continue;
      this.lanes.delete(id);
      this.sides.delete(id);
    }
    for (const b of state.wordBullets) {
      if (this.lanes.has(b.id)) continue;
      this.sides.set(b.id, this.nextSide);
      this.nextSide = this.nextSide === -1 ? 1 : -1;
      const count = LANES.map(() => 0);
      for (const lane of this.lanes.values()) count[lane]++;
      let best = 0;
      for (let i = 1; i < LANES.length; i++) if (count[i] < count[best]) best = i;
      this.lanes.set(b.id, best);
    }
  }

  /** World position of the word's center at its current Flight. */
  position(b: WordBulletState, out = new THREE.Vector3()) {
    const f = Math.min(Math.max(b.flight, 0), 1);
    const { start, end, laneSpread, muzzleX } = WORD_FLIGHT;
    const lane = LANES[this.lanes.get(b.id) ?? 0];
    const x0 = (this.sides.get(b.id) ?? 0) * muzzleX;
    return out.set(x0 + (lane * laneSpread - x0) * f, start.y + (end.y - start.y) * f, start.z + (end.z - start.z) * f);
  }
}
