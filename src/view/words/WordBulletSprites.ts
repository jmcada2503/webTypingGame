import * as THREE from 'three';
import { ASCII_STYLE } from '../../render/asciiStyle';
import { matchPrefix } from '../../utils/matchPrefix';
import type { GameViewState } from '../GameViewState';
import { WordBulletTracks } from './flightPath';

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

type Sprite = { sprite: THREE.Sprite; canvas: HTMLCanvasElement; paintedKey: string; aspect: number };

/**
 * Word bullets as crisp, real-font text (chosen in "Words in the ASCII world", variant D):
 * a camera-facing sprite per bullet at its 3D flight position, drawn in the overlay scene on top
 * of the ASCII frame, so it grows smoothly instead of snapping to the grid. Black backdrop keeps it
 * readable over the shading; Target prefix in green.
 */
export class WordBulletSprites {
  /** Pass to AsciiRenderer.render() as the overlay scene. */
  readonly scene = new THREE.Scene();
  private readonly tracks = new WordBulletTracks();
  private readonly sprites = new Map<string, Sprite>();

  update(state: GameViewState) {
    this.tracks.update(state);
    const alive = new Set(state.wordBullets.map((b) => b.id));
    for (const [id, s] of this.sprites) if (!alive.has(id)) this.remove(id, s);

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
      this.tracks.position(b, s.sprite.position);
      const h = WORD_LOOK.height * (1 + 2 * WORD_LOOK.padY);
      s.sprite.scale.set(h * s.aspect, h, 1);
    }
  }

  private add(id: string): Sprite {
    const canvas = document.createElement('canvas');
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    // Transparent → three sorts sprites back to front, so nearer words draw on top.
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthTest: false }));
    this.scene.add(sprite);
    const s = { sprite, canvas, paintedKey: '', aspect: 1 };
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
