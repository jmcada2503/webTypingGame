import * as THREE from 'three';
import { ASCII_STYLE } from '../../render/asciiStyle';
import { matchPrefix } from '../../utils/matchPrefix';
import type { GameViewState, ViewEvent } from '../GameViewState';
import { WordBulletTracks } from './flightPath';
import { FLIGHT_PROTO, FLIGHT_STYLES } from './flightVariants';

/** Live-tunable from the sandbox panel. */
export const WORD_LOOK = {
  /** Em size of a word in world units; perspective makes it grow as it nears the Cockpit. */
  height: 0.3,
  /** Black backdrop around the word: x in letter widths, y in em. */
  padX: 1,
  padY: 0,
};

/** Canvas px per em: high enough to stay crisp at the largest on-screen size. */
const EM_PX = 96;
const FONT = `400 ${EM_PX}px "${ASCII_STYLE.font.family}"`;

type Sprite = {
  sprite: THREE.Sprite;
  canvas: HTMLCanvasElement;
  paintedKey: string;
  aspect: number;
  seed: number;
  /** Smoothed on-screen push (NDC) from overlap avoidance. */
  push: THREE.Vector2;
  /** Set when the bullet arrived: plays the arrival animation, then goes. */
  exit?: { age: number; base: { pos: THREE.Vector3; sx: number; sy: number } };
};

const tmp = new THREE.Vector3();

/**
 * Word bullets as crisp, real-font text (chosen in "Words in the ASCII world", variant D):
 * a camera-facing sprite per bullet at its 3D flight position, drawn in the overlay scene on top
 * of the ASCII frame, so it grows smoothly instead of snapping to the grid. Black backdrop keeps it
 * readable over the shading; Target prefix in green.
 * PROTOTYPE hook: motion / arrival come from FLIGHT_STYLES[FLIGHT_PROTO.kind] ("Word bullets in flight").
 */
export class WordBulletSprites {
  /** Pass to AsciiRenderer.render() as the overlay scene. */
  readonly scene = new THREE.Scene();
  private readonly tracks = new WordBulletTracks();
  private readonly sprites = new Map<string, Sprite>();
  private t = 0;

  /** A ViewEvent for a bullet: arrival starts its exit animation. */
  onEvent(e: ViewEvent) {
    if (e.type !== 'wordBulletArrived') return;
    const s = this.sprites.get(e.id);
    const style = FLIGHT_STYLES[FLIGHT_PROTO.kind];
    if (s && style.arrivalSeconds > 0) {
      s.exit = { age: 0, base: { pos: s.sprite.position.clone(), sx: s.sprite.scale.x, sy: s.sprite.scale.y } };
    }
  }

  update(state: GameViewState, camera: THREE.PerspectiveCamera, dt: number) {
    this.t += dt;
    const style = FLIGHT_STYLES[FLIGHT_PROTO.kind];
    this.tracks.update(state);
    const alive = new Set(state.wordBullets.map((b) => b.id));

    for (const [id, s] of this.sprites) {
      if (alive.has(id)) continue;
      if (!s.exit) {
        this.remove(id, s);
        continue;
      }
      s.exit.age += dt;
      const k = s.exit.age / style.arrivalSeconds;
      if (k >= 1 || !style.arrive) this.remove(id, s);
      else style.arrive(s.sprite, k, s.exit.base, s.seed);
    }

    const live: Sprite[] = [];
    for (const b of state.wordBullets) {
      const s = this.sprites.get(b.id) ?? this.add(b.id);
      const matched = matchPrefix(state.typedWord, b.word);
      const key = `${matched}|${WORD_LOOK.padX}|${WORD_LOOK.padY}`;
      if (s.paintedKey !== key) {
        s.aspect = paint(s.canvas, [...b.word], matched);
        // The canvas may have changed size (padding): drop the GPU copy so it re-uploads.
        s.sprite.material.map!.dispose();
        s.sprite.material.map!.needsUpdate = true;
        s.paintedKey = key;
      }
      style.position({ flight: b.flight, lane: this.tracks.lane(b.id), seed: s.seed, t: this.t, camera }, s.sprite.position);
      const h = WORD_LOOK.height * (1 + 2 * WORD_LOOK.padY);
      s.sprite.scale.set(h * s.aspect, h, 1);
      live.push(s);
    }

    if (style.keepOnScreen) live.forEach((s) => this.keepOnScreen(s, camera));
    if (style.avoidOverlap) {
      this.pushApart(live, camera, dt);
      if (style.keepOnScreen) live.forEach((s) => this.keepOnScreen(s, camera));
    } else live.forEach((s) => s.push.set(0, 0));
  }

  /** Visible half extents (world units) at a sprite's depth. */
  private halfView(s: Sprite, camera: THREE.PerspectiveCamera) {
    const d = camera.position.z - s.sprite.position.z;
    const hh = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * d;
    return { hw: hh * camera.aspect, hh };
  }

  private keepOnScreen(s: Sprite, camera: THREE.PerspectiveCamera) {
    const { hw } = this.halfView(s, camera);
    const limit = Math.max(0, hw * 0.97 - s.sprite.scale.x / 2);
    s.sprite.position.x = Math.min(limit, Math.max(-limit, s.sprite.position.x));
  }

  /** Separate overlapping words on screen (NDC boxes), smoothed so they glide instead of jump. */
  private pushApart(live: Sprite[], camera: THREE.PerspectiveCamera, dt: number) {
    const boxes = live.map((s) => {
      const { hw, hh } = this.halfView(s, camera);
      tmp.copy(s.sprite.position).project(camera);
      return { s, x: tmp.x, y: tmp.y, w: s.sprite.scale.x / 2 / hw, h: s.sprite.scale.y / 2 / hh, hw, hh, dx: 0, dy: 0 };
    });
    // A few relaxation passes so crowds of 3+ words settle instead of fighting.
    for (let pass = 0; pass < 6; pass++)
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const ox = a.w + b.w - Math.abs(a.x + a.dx - (b.x + b.dx));
        const oy = a.h + b.h + 0.02 - Math.abs(a.y + a.dy - (b.y + b.dy));
        if (ox <= 0 || oy <= 0) continue;
        // Separate along the axis that needs less movement.
        if (oy < ox) {
          const dir = a.y + a.dy >= b.y + b.dy ? 1 : -1;
          a.dy += (dir * oy) / 2;
          b.dy -= (dir * oy) / 2;
        } else {
          const dir = a.x + a.dx >= b.x + b.dx ? 1 : -1;
          a.dx += (dir * ox) / 2;
          b.dx -= (dir * ox) / 2;
        }
      }
    }
    const k = 1 - Math.exp(-dt * 8);
    for (const b of boxes) {
      b.s.push.x += (b.dx - b.s.push.x) * k;
      b.s.push.y += (b.dy - b.s.push.y) * k;
      b.s.sprite.position.x += b.s.push.x * b.hw;
      b.s.sprite.position.y += b.s.push.y * b.hh;
    }
  }

  private add(id: string): Sprite {
    const canvas = document.createElement('canvas');
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    // Transparent → three sorts sprites back to front, so nearer words draw on top.
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthTest: false }));
    this.scene.add(sprite);
    const s: Sprite = { sprite, canvas, paintedKey: '', aspect: 1, seed: Number(id.replace(/\D/g, '')) || 0, push: new THREE.Vector2() };
    this.sprites.set(id, s);
    return s;
  }

  private remove(id: string, s: Sprite) {
    this.scene.remove(s.sprite);
    s.sprite.material.map?.dispose();
    s.sprite.material.dispose();
    this.sprites.delete(id);
  }

  dispose() {
    for (const [id, s] of this.sprites) this.remove(id, s);
  }
}

/** Black backdrop + word, matched letters green. Returns width / height. */
function paint(canvas: HTMLCanvasElement, letters: string[], matched: number) {
  const g = canvas.getContext('2d')!;
  g.font = FONT;
  const advance = g.measureText('M').width;
  const padX = WORD_LOOK.padX * advance;
  const padY = WORD_LOOK.padY * EM_PX;
  canvas.width = Math.ceil(advance * letters.length + 2 * padX);
  canvas.height = Math.ceil(EM_PX + 2 * padY);
  g.fillStyle = ASCII_STYLE.palette.bg;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.font = FONT; // resizing the canvas resets context state
  g.textBaseline = 'middle';
  letters.forEach((ch, i) => {
    g.fillStyle = i < matched ? ASCII_STYLE.palette.green : ASCII_STYLE.palette.fg;
    g.fillText(ch, padX + i * advance, canvas.height / 2 + EM_PX * 0.05);
  });
  return canvas.width / canvas.height;
}
