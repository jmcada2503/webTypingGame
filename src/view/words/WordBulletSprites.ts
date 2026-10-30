import * as THREE from 'three';
import { ASCII_STYLE } from '../../render/asciiStyle';
import { matchPrefix } from '../../utils/matchPrefix';
import type { GameViewState } from '../GameViewState';
import { WordBulletTracks } from './flightPath';
import { nextWordId } from './nextWord';

/** Live-tunable from the sandbox panel. */
export const WORD_LOOK = {
  /** Em size of a word in world units; perspective makes it grow as it nears the Cockpit. */
  height: 0.3,
  /** Black outline around each letter, in em: cuts the word out of the shading behind it. */
  border: 0.16,
};

/** The bar under the next word, in em: gap below the letters' middle, thickness, room added below (and above). */
const BAR = { gap: 0.55, thickness: 0.12, room: 0.35 };

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
 * ("Word bullets in flight"). Target prefix in green; a bar under the next word to type (`nextWord.ts`). Overlaps are allowed (the nearest word
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

    const next = nextWordId(state);
    for (const b of state.wordBullets) {
      const s = this.sprites.get(b.id) ?? this.add(b.id, b.word);
      const bar = b.id === next;
      const matched = matchPrefix(state.typedWord, b.word);
      s.pulse = Math.max(0, s.pulse - dt);
      const swell = 1 + PULSE_SCALE * (s.pulse / PULSE_SECONDS);
      const key = `${matched}|${WORD_LOOK.border}|${swell.toFixed(2)}|${bar}`;
      if (s.paintedKey !== key) {
        s.aspect = paint(s.canvas, [...b.word], matched, ASCII_STYLE.palette.fg, swell, bar);
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

/**
 * Transparent canvas: each letter stroked with a thick black outline, then filled (Target prefix green).
 * `bar`: an outlined bar under the word (the next one to type).
 */
function paint(canvas: HTMLCanvasElement, letters: string[], matched: number, color: string = ASCII_STYLE.palette.fg, swell = 1, bar = false) {
  const g = canvas.getContext('2d')!;
  g.font = FONT;
  const advance = g.measureText('M').width;
  const border = WORD_LOOK.border * EM_PX;
  const pad = border * 1.6;
  canvas.width = Math.ceil(advance * letters.length + 2 * pad);
  // The bar needs room below the word; the same room above keeps the word centred where it flies.
  canvas.height = Math.ceil(EM_PX + 2 * pad + (bar ? 2 * BAR.room * EM_PX : 0));
  g.font = FONT; // resizing the canvas resets context state
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  const y = canvas.height / 2 + EM_PX * 0.05;
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
  letters.forEach((_, i) => {
    g.fillStyle = i < matched ? ASCII_STYLE.palette.green : color;
    draw(i, (ch, px, py) => g.fillText(ch, px, py));
  });
  if (bar) {
    const top = y + EM_PX * BAR.gap;
    const width = advance * letters.length;
    const thick = EM_PX * BAR.thickness;
    g.fillStyle = ASCII_STYLE.palette.bg;
    g.fillRect(pad - border * 0.5, top - border * 0.5, width + border, thick + border);
    g.fillStyle = color;
    g.fillRect(pad, top, width, thick);
  }
  return canvas.width / canvas.height;
}
