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

/** Canvas px per em: high enough to stay crisp at the largest on-screen size. */
const EM_PX = 96;
const FONT = `400 ${EM_PX}px "${ASCII_STYLE.font.family}"`;

type Sprite = { sprite: THREE.Sprite; canvas: HTMLCanvasElement; paintedKey: string; aspect: number; word: string };

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

  update(state: GameViewState, camera: THREE.Camera) {
    this.tracks.update(state);
    const alive = new Set(state.wordBullets.map((b) => b.id));
    for (const [id, s] of this.sprites) if (!alive.has(id)) this.remove(id, s);

    for (const b of state.wordBullets) {
      const s = this.sprites.get(b.id) ?? this.add(b.id, b.word);
      const matched = matchPrefix(state.typedWord, b.word);
      const key = `${matched}|${WORD_LOOK.border}`;
      if (s.paintedKey !== key) {
        s.aspect = paint(s.canvas, [...b.word], matched);
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
    const s = { sprite, canvas, paintedKey: '', aspect: 1, word };
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
function paint(canvas: HTMLCanvasElement, letters: string[], matched: number, color: string = ASCII_STYLE.palette.fg) {
  const g = canvas.getContext('2d')!;
  g.font = FONT;
  const advance = g.measureText('M').width;
  const border = WORD_LOOK.border * EM_PX;
  const pad = border * 1.6;
  canvas.width = Math.ceil(advance * letters.length + 2 * pad);
  canvas.height = Math.ceil(EM_PX + 2 * pad);
  g.font = FONT; // resizing the canvas resets context state
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  const y = canvas.height / 2 + EM_PX * 0.05;
  const x = (i: number) => pad + i * advance;
  g.strokeStyle = ASCII_STYLE.palette.bg;
  g.lineWidth = border * 2;
  letters.forEach((ch, i) => g.strokeText(ch, x(i), y));
  letters.forEach((ch, i) => {
    g.fillStyle = i < matched ? ASCII_STYLE.palette.green : color;
    g.fillText(ch, x(i), y);
  });
  return canvas.width / canvas.height;
}
