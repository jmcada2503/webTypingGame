import * as THREE from 'three';
import type { GameViewState, WordBulletState } from '../GameViewState';

/**
 * Where Word bullets fly, in world units (camera at z = 7 looking at -z). Live-tunable from the
 * sandbox panel; "Word bullets in flight" decides the final path, curve and speeds.
 */
export const WORD_FLIGHT = {
  /** Leaving the Enemy ship (Flight 0). */
  start: { y: 6, z: -25 },
  /** Reaching the Cockpit (Flight 1): stops just above the yoke's Typed word screen. */
  end: { y: -0.6, z: 2.5 },
  /** World x between lanes at Flight 1 (lanes fan out from the Enemy ship). */
  laneSpread: 1.3,
};

/** Lane order: center first, then alternating outwards. */
const LANES = [0, -1, 1, -2, 2];

/** Each Word bullet gets a lane once (least used, center first) and keeps it for its whole flight. */
export class WordBulletTracks {
  private readonly lanes = new Map<string, number>();

  update(state: GameViewState) {
    const alive = new Set(state.wordBullets.map((b) => b.id));
    for (const id of this.lanes.keys()) if (!alive.has(id)) this.lanes.delete(id);
    for (const b of state.wordBullets) {
      if (this.lanes.has(b.id)) continue;
      const count = LANES.map(() => 0);
      for (const lane of this.lanes.values()) count[lane]++;
      let best = 0;
      for (let i = 1; i < LANES.length; i++) if (count[i] < count[best]) best = i;
      this.lanes.set(b.id, best);
    }
  }

  /** Lane value (-2..2, center 0) of a tracked bullet. */
  lane(id: string) {
    return LANES[this.lanes.get(id) ?? 0];
  }

  /** World position of the word's center at its current Flight. */
  position(b: WordBulletState, out = new THREE.Vector3()) {
    const f = Math.min(Math.max(b.flight, 0), 1);
    const { start, end, laneSpread } = WORD_FLIGHT;
    const lane = LANES[this.lanes.get(b.id) ?? 0];
    return out.set(lane * laneSpread * f, start.y + (end.y - start.y) * f, start.z + (end.z - start.z) * f);
  }
}
