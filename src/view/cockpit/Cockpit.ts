import * as THREE from 'three';
import type { TextGrid } from '../../render/AsciiRenderer';
import { ASCII_STYLE } from '../../render/asciiStyle';
import type { GameViewState } from '../GameViewState';
import { gridRectOf, writeCentered } from './gridProjection';
import { Radar, RADAR_SIZE } from './Radar';

const MAX_LIVES = 3;
const CURSOR_HZ = 1;
/** A lamp that just went out flickers this long (s) at this rate (Hz) before staying dark. */
const LAMP_FLICKER_SECONDS = 0.6;
const LAMP_FLICKER_HZ = 14;

/**
 * The player's Cockpit ("Cockpit design": pilot controls), built from primitives in camera-local
 * space (a group that sits at the camera, looking down -z):
 * - center: control yoke with the Typed word screen between the grips; just above its top edge,
 *   `ATTACK` at the left end and the Attack word (red) at the right end
 * - left console: Lives as 3 red lamps in black sockets (a lost life is a dim lamp; it flickers
 *   briefly when the life is lost)
 * - right console: the Radar (see Radar.ts)
 * - overhead bar framing the window
 *
 * Screens are black planes (→ blank cells); all readouts are grid text written at each screen's
 * projected position. Only the console labels (LIVES, RADAR) are real-font plates in the overlay,
 * following their panel's tilt and perspective.
 */
export class Cockpit {
  /** Real-font console labels; add to the overlay scene drawn after the ASCII pass. */
  readonly overlay = new THREE.Group();

  private readonly root = new THREE.Group();
  private readonly typedScreen: THREE.Mesh;
  private readonly typedBezel: THREE.Mesh;
  private readonly lamps: THREE.Mesh[] = [];
  private readonly lampOn = new THREE.MeshBasicMaterial({ color: ASCII_STYLE.palette.red });
  private readonly lampOff = gray(0.5, false);
  private readonly labelAnchors: { panel: THREE.Object3D; anchor: THREE.Object3D }[] = [];
  readonly radar: Radar;
  private t = 0;
  private lastLives = -1;
  /** Lamp index → seconds of flicker left. */
  private readonly flicker = new Map<number, number>();

  constructor(
    scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    this.root.position.copy(camera.position);
    scene.add(this.root);

    // Yoke: column, bar, two grips, Typed word screen between them.
    const metal = gray(0.75, false);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.6, 12), metal);
    column.position.set(0, -0.78, -1.35);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 12), metal);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, -0.48, -1.35);
    this.root.add(column, bar);
    for (const x of [-0.36, 0.36]) {
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.28, 12), gray(0.9, false));
      grip.position.set(x, -0.4, -1.35);
      this.root.add(grip);
    }
    this.typedBezel = box(0.56, 0.12, 0.03, gray(0.45));
    this.typedBezel.position.set(0, -0.4, -1.37);
    this.typedScreen = screen(0.5, 0.08);
    this.typedScreen.position.set(0, -0.4, -1.35);
    this.root.add(this.typedBezel, this.typedScreen);

    // Side consoles, angled toward the pilot.
    let radarScreen!: THREE.Mesh;
    for (const side of [-1, 1]) {
      const panel = new THREE.Group();
      panel.position.set(side * 0.8, -0.5, -1.6);
      panel.rotation.set(-0.7, -side * 0.4, 0);
      panel.add(box(0.62, 0.42, 0.06, gray(0.28)));
      this.addLabel(panel, side < 0 ? 'LIVES' : 'RADAR');

      if (side < 0) {
        for (let i = 0; i < MAX_LIVES; i++) {
          const x = -0.1 + i * 0.13;
          const socket = new THREE.Mesh(new THREE.CircleGeometry(0.062, 24), black()); // unlit lamps still read
          socket.position.set(x, 0.05, 0.032);
          const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 10), this.lampOn);
          lamp.position.set(x, 0.05, 0.06);
          this.lamps.push(lamp);
          panel.add(socket, lamp);
        }
      } else {
        // Nudged toward the center so the Radar's right end stays on screen.
        const bezel = box(RADAR_SIZE.w + 0.04, RADAR_SIZE.h + 0.04, 0.03, gray(0.7));
        bezel.position.set(-0.04, 0.03, 0.05);
        radarScreen = screen(RADAR_SIZE.w, RADAR_SIZE.h);
        radarScreen.position.set(-0.04, 0.03, 0.07);
        panel.add(bezel, radarScreen);
      }

      for (let i = 0; i < 5; i++) {
        const sw = box(0.04, 0.07, 0.04, gray(0.85));
        sw.position.set(-0.2 + i * 0.1, -0.17, 0.06);
        panel.add(sw);
      }
      this.root.add(panel);
    }
    this.radar = new Radar(radarScreen);

    const overhead = box(3, 0.12, 0.5, gray(0.4));
    overhead.position.set(0, 0.68, -1.3);
    this.root.add(overhead);
  }

  /** A label plate on the panel's top edge, in the panel's plane; drawn in the overlay. */
  private addLabel(panel: THREE.Object3D, str: string) {
    const plate = labelPlate(str, 0.05);
    plate.position.set(0, 0.21 + 0.035, 0.035);
    const anchor = new THREE.Group();
    anchor.matrixAutoUpdate = false; // gets the panel's world matrix every frame
    anchor.add(plate);
    this.overlay.add(anchor);
    this.labelAnchors.push({ panel, anchor });
  }

  update(state: GameViewState, dt: number, text: TextGrid) {
    this.t += dt;
    // A life lost: the lamp(s) that just went out flicker before staying dark ("Juice: Hit taken").
    if (this.lastLives >= 0 && state.lives < this.lastLives) {
      for (let i = state.lives; i < this.lastLives; i++) this.flicker.set(i, LAMP_FLICKER_SECONDS);
    }
    this.lastLives = state.lives;
    this.lamps.forEach((l, i) => {
      const left = this.flicker.get(i);
      if (left !== undefined) {
        if (left - dt <= 0 || i < state.lives) this.flicker.delete(i);
        else this.flicker.set(i, left - dt);
      }
      const flickering = this.flicker.has(i) && Math.floor(this.t * LAMP_FLICKER_HZ * 2) % 2 === 0;
      l.material = i < state.lives || flickering ? this.lampOn : this.lampOff;
    });
    for (const { panel, anchor } of this.labelAnchors) {
      panel.updateWorldMatrix(true, false);
      anchor.matrix.copy(panel.matrixWorld);
    }

    const cursor = Math.floor(this.t * CURSOR_HZ * 2) % 2 === 0 ? '_' : ' ';
    writeCentered(text, gridRectOf(this.typedScreen, this.camera), state.typedWord, 'fg', cursor);

    const edge = gridRectOf(this.typedBezel, this.camera, true);
    const row = edge.r0 - 1;
    text.fill(edge.c0, row, edge.c1 - edge.c0, 1, ' ');
    text.write(edge.c0 + 1, row, 'ATTACK', 'dim');
    text.write(edge.c1 - [...state.attackWord].length - 1, row, state.attackWord, 'red');

    this.radar.draw(text, this.camera, state.shots, dt);
  }

  dispose() {
    for (const root of [this.root, this.overlay]) {
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const m = o.material as THREE.MeshBasicMaterial;
          m.map?.dispose();
          m.dispose();
        }
      });
      root.removeFromParent();
    }
    this.lampOn.dispose();
    this.lampOff.dispose();
  }
}

function gray(v: number, flat = true) {
  return new THREE.MeshLambertMaterial({ color: new THREE.Color(v, v, v), flatShading: flat });
}
function black() {
  return new THREE.MeshBasicMaterial({ color: 0x000000 });
}
function box(w: number, h: number, d: number, m: THREE.Material) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
}
function screen(w: number, h: number) {
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), black());
}

/** A flat real-font label plate (canvas texture, letter-spaced, light gray). Height in world units. */
function labelPlate(str: string, height: number) {
  const em = 96;
  const spacing = em * 0.25;
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d')!;
  const font = `500 ${em}px "${ASCII_STYLE.font.family}"`;
  g.font = font;
  const w = [...str].reduce((a, ch) => a + g.measureText(ch).width + spacing, -spacing);
  canvas.width = Math.ceil(w + em * 0.4);
  canvas.height = Math.ceil(em * 1.2);
  g.font = font; // resizing the canvas resets context state
  g.fillStyle = '#9a9a9a';
  g.textBaseline = 'middle';
  let x = em * 0.2;
  for (const ch of str) {
    g.fillText(ch, x, canvas.height / 2);
    x += g.measureText(ch).width + spacing;
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(
    new THREE.PlaneGeometry((height * canvas.width) / canvas.height, height),
    new THREE.MeshBasicMaterial({ map, transparent: true, depthTest: false }),
  );
}
