import * as THREE from 'three';
import type { PaletteColor, TextGrid } from '../../render/AsciiRenderer';
import { ASCII_STYLE } from '../../render/asciiStyle';

/** A rectangle in grid cells (fractional unless rounded). */
export type GridRect = { c0: number; r0: number; c1: number; r1: number };

const box = new THREE.Box3();
const corner = new THREE.Vector3();

/** Fractional grid position of a world point. */
export function worldToGrid(world: THREE.Vector3, camera: THREE.Camera) {
  const { cols, rows } = ASCII_STYLE.grid;
  const p = corner.copy(world).project(camera);
  return { col: ((p.x + 1) / 2) * cols, row: ((1 - p.y) / 2) * rows };
}

/** Grid area an object covers on screen (bounding box of its projected corners). */
export function gridRectOf(obj: THREE.Object3D, camera: THREE.Camera, round = false): GridRect {
  obj.updateWorldMatrix(true, true);
  box.setFromObject(obj);
  let c0 = Infinity, r0 = Infinity, c1 = -Infinity, r1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
    const { col, row } = worldToGrid(corner, camera);
    c0 = Math.min(c0, col); c1 = Math.max(c1, col); r0 = Math.min(r0, row); r1 = Math.max(r1, row);
  }
  return round ? { c0: Math.round(c0), r0: Math.round(r0), c1: Math.round(c1), r1: Math.round(r1) } : { c0, r0, c1, r1 };
}

/** Write `str` centered on both axes of a fractional rect; `suffix` follows it without shifting it. */
/** Like writeCentered, but at `scale` × the normal glyph size (fractional position). */
export function writeCenteredScaled(text: TextGrid, rect: GridRect, str: string, scale: number, color: PaletteColor, suffix = '') {
  const col = (rect.c0 + rect.c1) / 2 - ([...str + suffix].length * scale) / 2;
  const row = (rect.r0 + rect.r1) / 2 - scale / 2;
  text.writeScaled(col, row, str + suffix, scale, color);
}

export function writeCentered(text: TextGrid, rect: GridRect, str: string, color: PaletteColor, suffix = '') {
  const col = Math.round((rect.c0 + rect.c1) / 2 - [...str].length / 2);
  const row = Math.round((rect.r0 + rect.r1) / 2 - 0.5);
  text.write(col, row, str + suffix, color);
}
