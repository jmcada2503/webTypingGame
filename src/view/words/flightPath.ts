import * as THREE from 'three';
import type { GameViewState, WordBulletState } from '../GameViewState';

/**
 * Where Word bullets fly, in world units (camera at z = 7 looking at -z). Live-tunable from the
 * sandbox panel. Speed is the game's (Flight per second); arrival = the bullet simply vanishes.
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

  /**
   * World position of the word's center at its current Flight ("Word bullets in flight": steady).
   * Screen position and on-screen size change linearly with Flight, so words move down and grow
   * at a constant rate (a straight 3D line would stay small, then balloon at the end).
   */
  position(b: WordBulletState, camera: THREE.Camera, out = new THREE.Vector3()) {
    const f = Math.min(Math.max(b.flight, 0), 1);
    const { start, end, laneSpread } = WORD_FLIGHT;
    const cam = camera.position;
    const d0 = cam.z - start.z;
    const d1 = cam.z - end.z;
    const d = 1 / (1 / d0 + (1 / d1 - 1 / d0) * f); // 1/depth linear → projected size linear
    const sy = (start.y - cam.y) / d0 + ((end.y - cam.y) / d1 - (start.y - cam.y) / d0) * f;
    const sx = ((this.lane(b.id) * laneSpread) / d1) * f;
    return out.set(cam.x + sx * d, cam.y + sy * d, cam.z - d);
  }
}
