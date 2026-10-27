// PROTOTYPE ("Words in the ASCII world"): shared 3D flight path for every word variant,
// so the variants differ only in how the word is drawn, not in how it moves.
import * as THREE from 'three';
import { ASCII_STYLE } from '../../render/asciiStyle';
import type { GameViewState, WordBulletState } from '../GameViewState';

/** Live-tunable from the sandbox panel. World units; camera at z = 7 looking at -z. */
export const WORDS_PROTO = {
  /** Em size of a word in world units. */
  wordHeight: 0.3,
  start: { y: 6, z: -25 },
  end: { y: -1.1, z: 2.5 },
  /** World x between lanes at the end of the flight (lanes fan out from the Enemy ship). */
  laneSpread: 1.3,
  /** Blank cells around the word (grid variants). */
  padX: 1,
  padY: 0,
  /** Lean back (radians) for the 3D variant. */
  tilt: 0.35,
  /** Extrusion depth (em) for the 3D variant. */
  depth: 0.25,
};

/** Lane order: center first, then alternating outwards. */
const LANES = [0, -1, 1, -2, 2];
/** IBM Plex Mono advance width / em. */
export const ADVANCE = 0.6;

/** Each Word bullet gets a lane once (least used, center first) and keeps it for its whole flight. */
export class BulletTracks {
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

  /** World position of the word's center. */
  position(b: WordBulletState, out = new THREE.Vector3()) {
    const f = Math.min(Math.max(b.flight, 0), 1);
    const { start, end, laneSpread } = WORDS_PROTO;
    const lane = LANES[this.lanes.get(b.id) ?? 0];
    return out.set(lane * laneSpread * f, start.y + (end.y - start.y) * f, start.z + (end.z - start.z) * f);
  }
}

/** Where a world point lands on the 128×45 grid, and how many cells one world unit spans there. */
export function projectToGrid(world: THREE.Vector3, camera: THREE.PerspectiveCamera) {
  const { cols, rows } = ASCII_STYLE.grid;
  const ndc = world.clone().project(camera);
  const dist = camera.position.z - world.z;
  const viewH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist;
  return {
    col: ((ndc.x + 1) / 2) * cols,
    row: ((1 - ndc.y) / 2) * rows,
    rowsPerUnit: rows / viewH,
    colsPerUnit: cols / (viewH * camera.aspect),
  };
}
