import * as THREE from 'three';
import { ASCII_STYLE } from '../../render/asciiStyle';
import { matchPrefix } from '../../utils/matchPrefix';
import type { GameViewState } from '../GameViewState';
import { WordBulletTracks } from './flightPath';

/** Live-tunable from the sandbox panel. */
export const WORD_LOOK = {
  /** Em size of a word in world units; perspective makes it grow as it nears the Cockpit. */
  height: 0.3,
  /** Black outline around each letter, in em: cuts the word out of the shading behind it. */
  border: 0.16,
};

/**
 * PROTOTYPE (ticket "Point to the next nearest Word bullet"), throwaway: how to point out the next word to type.
 * `variant` comes from `?nearest=` (A | B | C | D, anything else = off); the dev bar switches it live.
 * - A: brightness by Flight (far = dim, near = full white).
 * - B: the next word glows; the others are slightly dimmed.
 * - C: a bar under the next word; brightness untouched.
 * - D: A + B.
 * "Next" = the nearest Word bullet that isn't the one being typed (the Target matching the Typed word);
 * with nothing typed, the nearest one.
 */
export const NEAREST_PROTO = {
  variant: new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('nearest') ?? 'off',
  /** Brightness of the farthest word in A / D (0..1). */
  far: 0.35,
  /** Brightness of the other words in B. */
  others: 0.7,
};

type Mark = 'none' | 'glow' | 'bar';

/** Which bullet is "next", and how bright each one is, for the current variant. */
function nearestLook(state: GameViewState): Map<string, { light: number; mark: Mark }> {
  const v = NEAREST_PROTO.variant;
  const out = new Map<string, { light: number; mark: Mark }>();
  const byNear = [...state.wordBullets].sort((a, b) => b.flight - a.flight);
  const len = [...state.typedWord].length;
  const target = len > 0 ? byNear.find((b) => matchPrefix(state.typedWord, b.word) === len) : undefined;
  const next = byNear.find((b) => b !== target);
  for (const b of byNear) {
    const isTarget = b === target;
    const isNext = b === next;
    const byFlight = NEAREST_PROTO.far + (1 - NEAREST_PROTO.far) * Math.min(1, Math.max(0, b.flight));
    let light = 1;
    let mark: Mark = 'none';
    if (v === 'A') light = isTarget ? 1 : byFlight;
    if (v === 'B') [light, mark] = isTarget || isNext ? [1, isNext ? 'glow' : 'none'] : [NEAREST_PROTO.others, 'none'];
    if (v === 'C') mark = isNext ? 'bar' : 'none';
    if (v === 'D') [light, mark] = isTarget || isNext ? [1, isNext ? 'glow' : 'none'] : [byFlight, 'none'];
    out.set(b.id, { light, mark });
  }
  return out;
}

/** Canvas px per em: high enough to stay crisp at the largest on-screen size. */
const EM_PX = 96;
const FONT = `400 ${EM_PX}px "${ASCII_STYLE.font.family}"`;

type Sprite = { sprite: THREE.Sprite; canvas: HTMLCanvasElement; paintedKey: string; aspect: number; word: string; pulse: number };

/** A correct key makes the Target's next letter swell briefly (s, extra scale). */
const PULSE_SECONDS = 0.18;
const PULSE_SCALE = 0.45;

/** A Word bullet's last look, handed to destroy effects. */
export type WordSnapshot = {
  letters: string[];
  /** World position of the word's center. */
  center: THREE.Vector3;
  /** World size of one em (letter height) at that moment. */
  em: number;
};

/**
 * Word bullets drawn over the ASCII frame in real font ("Words in the ASCII world"): a camera-facing
 * sprite per bullet at its 3D flight position (steady path, see flightPath.ts), so it grows as it
 * nears the Cockpit. No backdrop box: each letter has a thick black outline instead
 * ("Word bullets in flight"). Target prefix in green. Overlaps are allowed (the nearest word
 * draws on top); arrival = the bullet vanishes.
 */
export class WordBulletSprites {
  /** Pass to AsciiRenderer.render() as the overlay scene. */
  readonly scene = new THREE.Scene();
  private readonly tracks = new WordBulletTracks();
  private readonly sprites = new Map<string, Sprite>();

  /** Correct key: the next letter of this Target swells for a moment. */
  pulse(id: string) {
    const s = this.sprites.get(id);
    if (s) s.pulse = PULSE_SECONDS;
  }

  update(state: GameViewState, camera: THREE.Camera, dt = 0) {
    this.tracks.update(state);
    const alive = new Set(state.wordBullets.map((b) => b.id));
    for (const [id, s] of this.sprites) if (!alive.has(id)) this.remove(id, s);

    const looks = nearestLook(state);
    for (const b of state.wordBullets) {
      const s = this.sprites.get(b.id) ?? this.add(b.id, b.word);
      const look = looks.get(b.id) ?? { light: 1, mark: 'none' as Mark };
      s.sprite.material.color.setScalar(look.light);
      const matched = matchPrefix(state.typedWord, b.word);
      s.pulse = Math.max(0, s.pulse - dt);
      const swell = 1 + PULSE_SCALE * (s.pulse / PULSE_SECONDS);
      const key = `${matched}|${WORD_LOOK.border}|${swell.toFixed(2)}|${look.mark}`;
      if (s.paintedKey !== key) {
        s.aspect = paint(s.canvas, [...b.word], matched, ASCII_STYLE.palette.fg, swell, look.mark);
        // The canvas may have changed size: drop the GPU copy so it re-uploads.
        s.sprite.material.map!.dispose();
        s.sprite.material.map!.needsUpdate = true;
        s.paintedKey = key;
      }
      this.tracks.position(b, camera, s.sprite.position);
      const h = WORD_LOOK.height * (s.canvas.height / EM_PX);
      s.sprite.scale.set(h * s.aspect, h, 1);
    }
  }

  /** Removes a bullet's sprite now and returns how it looked (for its destroy effect). */
  take(id: string): WordSnapshot | null {
    const s = this.sprites.get(id);
    if (!s) return null;
    const snap = { letters: [...s.word], center: s.sprite.position.clone(), em: WORD_LOOK.height };
    this.remove(id, s);
    return snap;
  }

  private add(id: string, word: string): Sprite {
    const canvas = document.createElement('canvas');
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    // Transparent → three sorts sprites back to front, so nearer words draw on top.
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthTest: false }));
    this.scene.add(sprite);
    const s = { sprite, canvas, paintedKey: '', aspect: 1, word, pulse: 0 };
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

/** One outlined glyph on a transparent canvas (used by destroy shards). Returns width / height. */
export function paintGlyph(canvas: HTMLCanvasElement, ch: string, color: string) {
  return paint(canvas, [ch], 0, color);
}

/** Transparent canvas: each letter stroked with a thick black outline, then filled (Target prefix green). */
function paint(canvas: HTMLCanvasElement, letters: string[], matched: number, color: string = ASCII_STYLE.palette.fg, swell = 1, mark: Mark = 'none') {
  const g = canvas.getContext('2d')!;
  g.font = FONT;
  const advance = g.measureText('M').width;
  const border = WORD_LOOK.border * EM_PX;
  const pad = border * 1.6;
  canvas.width = Math.ceil(advance * letters.length + 2 * pad);
  canvas.height = Math.ceil(EM_PX + 2 * pad + (mark === 'bar' ? EM_PX * 0.35 : 0));
  g.font = FONT; // resizing the canvas resets context state
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  const y = (mark === 'bar' ? canvas.height - EM_PX * 0.35 : canvas.height) / 2 + EM_PX * 0.05;
  const x = (i: number) => pad + i * advance;
  g.strokeStyle = ASCII_STYLE.palette.bg;
  g.lineWidth = border * 2;
  // The next letter to type (index `matched`) can swell (correct-key pulse), scaled about its center.
  const draw = (i: number, op: (ch: string, px: number, py: number) => void) => {
    const scale = i === matched ? swell : 1;
    if (scale === 1) return op(letters[i], x(i), y);
    g.save();
    g.translate(x(i) + advance / 2, y);
    g.scale(scale, scale);
    op(letters[i], -advance / 2, 0);
    g.restore();
  };
  letters.forEach((_, i) => draw(i, (ch, px, py) => g.strokeText(ch, px, py)));
  if (mark === 'glow') {
    g.shadowColor = 'rgba(255,255,255,0.9)';
    g.shadowBlur = EM_PX * 0.35;
  }
  letters.forEach((_, i) => {
    g.fillStyle = i < matched ? ASCII_STYLE.palette.green : color;
    draw(i, (ch, px, py) => g.fillText(ch, px, py));
  });
  g.shadowBlur = 0;
  if (mark === 'bar') {
    const top = y + EM_PX * 0.55;
    g.fillStyle = ASCII_STYLE.palette.bg;
    g.fillRect(pad - border * 0.5, top - border * 0.5, advance * letters.length + border, EM_PX * 0.12 + border);
    g.fillStyle = ASCII_STYLE.palette.fg;
    g.fillRect(pad, top, advance * letters.length, EM_PX * 0.12);
  }
  return canvas.width / canvas.height;
}
