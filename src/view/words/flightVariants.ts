// PROTOTYPE ("Word bullets in flight"): four ways Word bullets fly, ?variant=A..D. Throwaway.
// Each style maps Flight (0..1, owned by the game) to a world position, says whether bullets are
// kept on screen / pushed apart, and how arrival at the Cockpit looks.
import * as THREE from 'three';
import { ASCII_STYLE } from '../../render/asciiStyle';
import { WORD_FLIGHT } from './flightPath';

export const FLIGHT_VARIANTS = [
  { key: 'A', name: 'Baseline: straight 3D line, vanish on arrival' },
  { key: 'B', name: 'Steady on screen, kept on screen, red flash arrival' },
  { key: 'C', name: 'Swooping arcs, slow then fast, sucked into the yoke' },
  { key: 'D', name: 'Steady + no overlaps (push apart), shake & drop arrival' },
];
export type FlightKind = 'A' | 'B' | 'C' | 'D';

/** Live-tunable from the sandbox panel. */
export const FLIGHT_PROTO = { kind: 'A' as FlightKind, arcAmount: 1.4, wobble: 0.15 };

export type FlightCtx = {
  flight: number;
  /** Lane value, -2..2 (center = 0). */
  lane: number;
  /** Stable per-bullet number (spawn order). */
  seed: number;
  t: number;
  camera: THREE.PerspectiveCamera;
};

export type FlightStyle = {
  position(c: FlightCtx, out: THREE.Vector3): void;
  /** Shift long words back inside the screen. */
  keepOnScreen: boolean;
  /** Push overlapping words apart on screen. */
  avoidOverlap: boolean;
  /** Seconds the arrival animation lasts (0 = vanish). */
  arrivalSeconds: number;
  /** k = 0..1 through the arrival; `base` = position / scale at the moment of arrival. */
  arrive?(sprite: THREE.Sprite, k: number, base: { pos: THREE.Vector3; sx: number; sy: number }, seed: number): void;
};

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
/** Yoke Typed word screen, camera-local (see Cockpit.ts). */
const YOKE_LOCAL = new THREE.Vector3(0, -0.4, -1.35);

/** Straight line in world space: perspective makes growth speed up near the end. */
function straight(c: FlightCtx, out: THREE.Vector3, f = clamp01(c.flight)) {
  const { start, end, laneSpread } = WORD_FLIGHT;
  out.set(c.lane * laneSpread * f, lerp(start.y, end.y, f), lerp(start.z, end.z, f));
}

/** Screen position and on-screen size change linearly with Flight (steady, easy to track). */
function steady(c: FlightCtx, out: THREE.Vector3) {
  const cam = c.camera.position;
  const { start, end, laneSpread } = WORD_FLIGHT;
  const d0 = cam.z - start.z;
  const d1 = cam.z - end.z;
  const f = clamp01(c.flight);
  const d = 1 / lerp(1 / d0, 1 / d1, f); // 1/d linear → projected size linear
  const sy = lerp((start.y - cam.y) / d0, (end.y - cam.y) / d1, f);
  const sx = lerp(0, (c.lane * laneSpread) / d1, f);
  out.set(cam.x + sx * d, cam.y + sy * d, cam.z - d);
}

/** Curved swoop out to one side and back into the lane, wobbling while far; slow far, fast near. */
function swoop(c: FlightCtx, out: THREE.Vector3) {
  const f = clamp01(c.flight);
  const e = 0.35 * f + 0.65 * f * f;
  straight(c, out, e);
  const side = c.seed % 2 === 0 ? 1 : -1;
  out.x += side * FLIGHT_PROTO.arcAmount * Math.sin(Math.PI * e) + Math.sin(c.t * 3 + c.seed) * FLIGHT_PROTO.wobble * (1 - e) * 4;
}

const red = new THREE.Color(ASCII_STYLE.palette.red);
const white = new THREE.Color(1, 1, 1);

export const FLIGHT_STYLES: Record<FlightKind, FlightStyle> = {
  A: { position: (c, o) => straight(c, o), keepOnScreen: false, avoidOverlap: false, arrivalSeconds: 0 },
  B: {
    position: steady,
    keepOnScreen: true,
    avoidOverlap: false,
    arrivalSeconds: 0.35,
    arrive(sprite, k, base) {
      sprite.position.copy(base.pos);
      const s = 1 + 0.45 * k;
      sprite.scale.set(base.sx * s, base.sy * s, 1);
      sprite.material.color.copy(white).lerp(red, Math.min(1, k * 3));
      sprite.material.opacity = 1 - k;
    },
  },
  C: {
    position: swoop,
    keepOnScreen: true,
    avoidOverlap: false,
    arrivalSeconds: 0.4,
    arrive(sprite, k, base) {
      const target = YOKE_LOCAL.clone().add(new THREE.Vector3(0, 0, 7));
      const e = k * k;
      sprite.position.copy(base.pos).lerp(target, e);
      sprite.scale.set(base.sx * (1 - e), base.sy * (1 - e), 1);
    },
  },
  D: {
    position: steady,
    keepOnScreen: true,
    avoidOverlap: true,
    arrivalSeconds: 0.5,
    arrive(sprite, k, base, seed) {
      sprite.position.copy(base.pos);
      if (k < 0.4) sprite.position.x += Math.sin(k * 90 + seed) * 0.06;
      else sprite.position.y -= (k - 0.4) * 2;
      sprite.scale.set(base.sx, base.sy, 1);
      sprite.material.opacity = k < 0.4 ? 1 : 1 - (k - 0.4) / 0.6;
    },
  },
};
