// PROTOTYPE ("Words in the ASCII world"): four radically different ways to draw Word bullets.
// All share BulletTracks (same 3D path, same lanes); only the drawing differs. Throwaway.
import * as THREE from 'three';
import opentype from 'opentype.js';
import plexBoldWoff from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-700-normal.woff?url';
import { ASCII_STYLE } from '../../render/asciiStyle';
import type { TextGrid } from '../../render/AsciiRenderer';
import { matchPrefix } from '../../utils/matchPrefix';
import type { GameViewState } from '../GameViewState';
import { ADVANCE, BulletTracks, projectToGrid, WORDS_PROTO } from './tracks';

export type WordLayerCtx = { state: GameViewState; camera: THREE.PerspectiveCamera; text: TextGrid };

export interface WordLayer {
  draw(ctx: WordLayerCtx): void;
  /** Drawn after the ASCII pass with no ASCII treatment (variant D). */
  readonly overlay?: THREE.Scene;
  dispose(): void;
}

export const WORD_VARIANTS = [
  { key: 'A', name: 'Grid letters, spacing grows' },
  { key: 'B', name: 'Big ASCII-art lettering' },
  { key: 'C', name: '3D letters through the ASCII shader' },
  { key: 'D', name: 'Smooth font over the ASCII (hybrid)' },
  { key: 'E', name: '3D plate in the shader + grid letters' },
];

export async function createWordLayer(key: string, scene: THREE.Scene): Promise<WordLayer> {
  if (key === 'B') return new AsciiArtWords();
  if (key === 'C') return MeshWords.create(scene);
  if (key === 'D') return new OverlayWords();
  if (key === 'E') return new PlateWords(scene);
  return new SpacedGridWords();
}

const pos = new THREE.Vector3();

// ---------------------------------------------------------------- A
/** Each letter is one grid glyph at its projected spot; letters spread apart as the word nears. */
class SpacedGridWords implements WordLayer {
  private readonly tracks = new BulletTracks();

  draw({ state, camera, text }: WordLayerCtx) {
    this.tracks.update(state);
    const { padX, padY, wordHeight } = WORDS_PROTO;
    const placed = state.wordBullets.map((b) => {
      const p = projectToGrid(this.tracks.position(b, pos), camera);
      const letters = [...b.word];
      const step = Math.max(1, Math.round(ADVANCE * wordHeight * p.colsPerUnit));
      const first = Math.round(p.col - ((letters.length - 1) * step) / 2);
      return { letters, step, first, row: Math.round(p.row), matched: matchPrefix(state.typedWord, b.word) };
    });
    for (const w of placed) {
      text.fill(w.first - padX, w.row - padY, (w.letters.length - 1) * w.step + 1 + 2 * padX, 1 + 2 * padY, ' ');
    }
    for (const w of placed) {
      w.letters.forEach((ch, i) => text.write(w.first + i * w.step, w.row, ch, i < w.matched ? 'green' : 'fg'));
    }
  }

  dispose() {}
}

// ---------------------------------------------------------------- B
/** The word is rasterized at its projected size, then each cell becomes a ramp glyph by ink coverage. */
class AsciiArtWords implements WordLayer {
  private readonly tracks = new BulletTracks();
  private readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  /** Canvas px per cell (keeps the 10:16 cell shape). */
  private static readonly PX = { w: 5, h: 8 };
  private static readonly FILL = ' .:-=+*#%@';

  draw({ state, camera, text }: WordLayerCtx) {
    this.tracks.update(state);
    const { padX, padY, wordHeight } = WORDS_PROTO;
    const jobs = state.wordBullets.map((b) => {
      const p = projectToGrid(this.tracks.position(b, pos), camera);
      return { b, p, letters: [...b.word], rowsTall: wordHeight * p.rowsPerUnit, matched: matchPrefix(state.typedWord, b.word) };
    });

    // Backdrops first so one word's padding never erases another word's letters.
    const boxes = jobs.map((j) => {
      if (j.rowsTall < 3.5) {
        const first = Math.round(j.p.col - j.letters.length / 2);
        return { ...j, small: true, c0: first, r0: Math.round(j.p.row), w: j.letters.length, h: 1 };
      }
      const w = Math.ceil(j.letters.length * ADVANCE * wordHeight * j.p.colsPerUnit) + 1;
      const h = Math.ceil(j.rowsTall * 0.8) + 1;
      return { ...j, small: false, c0: Math.round(j.p.col - w / 2), r0: Math.round(j.p.row - h / 2), w, h };
    });
    for (const x of boxes) text.fill(x.c0 - padX, x.r0 - padY, x.w + 2 * padX, x.h + 2 * padY, ' ');

    for (const x of boxes) {
      if (x.small) {
        x.letters.forEach((ch, i) => text.write(x.c0 + i, x.r0, ch, i < x.matched ? 'green' : 'fg'));
        continue;
      }
      this.stamp(text, x.letters, x.matched, x.c0, x.r0, x.w, x.h, x.rowsTall);
    }
  }

  private stamp(text: TextGrid, letters: string[], matched: number, c0: number, r0: number, w: number, h: number, rowsTall: number) {
    const { w: pw, h: ph } = AsciiArtWords.PX;
    const cw = w * pw;
    const chh = h * ph;
    this.canvas.width = cw;
    this.canvas.height = chh;
    const g = this.ctx;
    const em = rowsTall * ph;
    g.font = `700 ${em}px "${ASCII_STYLE.font.family}"`;
    g.textBaseline = 'middle';
    g.fillStyle = '#fff';
    const adv = g.measureText('M').width;
    const x0 = cw / 2 - (adv * letters.length) / 2;
    g.strokeStyle = '#fff';
    g.lineWidth = em * 0.06;
    g.lineJoin = 'round';
    letters.forEach((ch, i) => {
      g.fillText(ch, x0 + i * adv, chh / 2 + em * 0.05);
      g.strokeText(ch, x0 + i * adv, chh / 2 + em * 0.05);
    });
    const data = g.getImageData(0, 0, cw, chh).data;
    const fill = AsciiArtWords.FILL;
    for (let cy = 0; cy < h; cy++) {
      for (let cx = 0; cx < w; cx++) {
        let ink = 0;
        for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) ink += data[((cy * ph + y) * cw + cx * pw + x) * 4 + 3];
        const cov = ink / (pw * ph * 255);
        if (cov < 0.08) continue;
        const letter = Math.floor((cx * pw + pw / 2 - x0) / adv);
        const glyph = fill[Math.min(fill.length - 1, Math.max(1, Math.round(cov * (fill.length - 1))))];
        text.write(c0 + cx, r0 + cy, glyph, letter < matched ? 'green' : 'fg');
      }
    }
  }

  dispose() {}
}

// ---------------------------------------------------------------- C
/** Extruded 3D letters in the scene, lit like everything else, turned into ASCII by the shader. */
class MeshWords implements WordLayer {
  private readonly tracks = new BulletTracks();
  private readonly groups = new Map<string, { group: THREE.Group; word: string; matched: number }>();
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  private readonly white = new THREE.MeshLambertMaterial({ color: 0xffffff });
  private readonly green = new THREE.MeshLambertMaterial({ color: 0x00ff00 });
  private builtFor = { depth: -1 };

  static async create(scene: THREE.Scene) {
    const buf = await (await fetch(plexBoldWoff)).arrayBuffer();
    return new MeshWords(scene, opentype.parse(buf));
  }

  private constructor(
    private readonly scene: THREE.Scene,
    private readonly font: opentype.Font,
  ) {}

  /** Glyph outline (em = 1, baseline at y = 0) → extruded geometry. Cached per char. */
  private glyph(ch: string) {
    if (this.builtFor.depth !== WORDS_PROTO.depth) {
      this.geometries.forEach((g) => g.dispose());
      this.geometries.clear();
      this.builtFor.depth = WORDS_PROTO.depth;
    }
    let geo = this.geometries.get(ch);
    if (geo) return geo;
    const path = new THREE.ShapePath();
    for (const c of this.font.getPath(ch, 0, 0, 1).commands) {
      // opentype is y-down; three is y-up.
      if (c.type === 'M') path.moveTo(c.x, -c.y);
      else if (c.type === 'L') path.lineTo(c.x, -c.y);
      else if (c.type === 'Q') path.quadraticCurveTo(c.x1, -c.y1, c.x, -c.y);
      else if (c.type === 'C') path.bezierCurveTo(c.x1, -c.y1, c.x2, -c.y2, c.x, -c.y);
    }
    geo = new THREE.ExtrudeGeometry(path.toShapes(), { depth: WORDS_PROTO.depth, bevelEnabled: false, curveSegments: 4 });
    this.geometries.set(ch, geo);
    return geo;
  }

  draw({ state }: WordLayerCtx) {
    this.tracks.update(state);
    const alive = new Set(state.wordBullets.map((b) => b.id));
    for (const [id, g] of this.groups) {
      if (!alive.has(id)) {
        this.scene.remove(g.group);
        this.groups.delete(id);
      }
    }
    for (const b of state.wordBullets) {
      const matched = matchPrefix(state.typedWord, b.word);
      let entry = this.groups.get(b.id);
      if (!entry) {
        const group = new THREE.Group();
        const letters = [...b.word];
        letters.forEach((ch, i) => {
          const m = new THREE.Mesh(this.glyph(ch), this.white);
          m.position.set((i - letters.length / 2) * ADVANCE, -0.35, -WORDS_PROTO.depth / 2);
          group.add(m);
        });
        this.scene.add(group);
        entry = { group, word: b.word, matched: -1 };
        this.groups.set(b.id, entry);
      }
      if (entry.matched !== matched) {
        entry.group.children.forEach((m, i) => ((m as THREE.Mesh).material = i < matched ? this.green : this.white));
        entry.matched = matched;
      }
      this.tracks.position(b, entry.group.position);
      entry.group.scale.setScalar(WORDS_PROTO.wordHeight);
      entry.group.rotation.x = -WORDS_PROTO.tilt;
    }
  }

  dispose() {
    this.groups.forEach((g) => this.scene.remove(g.group));
    this.geometries.forEach((g) => g.dispose());
    this.white.dispose();
    this.green.dispose();
  }
}

// ---------------------------------------------------------------- D
/** Crisp real-font sprites at the 3D position, drawn on top of the ASCII frame; grow smoothly. */
class OverlayWords implements WordLayer {
  readonly overlay = new THREE.Scene();
  private readonly tracks = new BulletTracks();
  private readonly sprites = new Map<string, { sprite: THREE.Sprite; canvas: HTMLCanvasElement; matched: number; aspect: number }>();
  private static readonly EM = 96;

  draw({ state }: WordLayerCtx) {
    this.tracks.update(state);
    const alive = new Set(state.wordBullets.map((b) => b.id));
    for (const [id, s] of this.sprites) {
      if (!alive.has(id)) {
        this.overlay.remove(s.sprite);
        s.sprite.material.map?.dispose();
        s.sprite.material.dispose();
        this.sprites.delete(id);
      }
    }
    for (const b of state.wordBullets) {
      const matched = matchPrefix(state.typedWord, b.word);
      let s = this.sprites.get(b.id);
      if (!s) {
        const canvas = document.createElement('canvas');
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
        this.overlay.add(sprite);
        s = { sprite, canvas, matched: -1, aspect: 1 };
        this.sprites.set(b.id, s);
      }
      if (s.matched !== matched) {
        s.aspect = this.paint(s.canvas, [...b.word], matched);
        s.sprite.material.map!.needsUpdate = true;
        s.matched = matched;
      }
      this.tracks.position(b, s.sprite.position);
      const h = WORDS_PROTO.wordHeight * (1 + 2 * WORDS_PROTO.padY * 0.6);
      s.sprite.scale.set(h * s.aspect, h, 1);
    }
  }

  /** Black backdrop + word, matched letters green. Returns width / height. */
  private paint(canvas: HTMLCanvasElement, letters: string[], matched: number) {
    const em = OverlayWords.EM;
    const g = canvas.getContext('2d')!;
    const font = `500 ${em}px "${ASCII_STYLE.font.family}"`;
    g.font = font;
    const adv = g.measureText('M').width;
    const padX = WORDS_PROTO.padX * adv;
    const padY = WORDS_PROTO.padY * em * 0.6;
    canvas.width = Math.ceil(adv * letters.length + 2 * padX);
    canvas.height = Math.ceil(em + 2 * padY);
    g.fillStyle = '#000';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.font = font;
    g.textBaseline = 'middle';
    letters.forEach((ch, i) => {
      g.fillStyle = i < matched ? ASCII_STYLE.palette.green : ASCII_STYLE.palette.fg;
      g.fillText(ch, padX + i * adv, canvas.height / 2 + em * 0.05);
    });
    return canvas.width / canvas.height;
  }

  dispose() {
    this.sprites.forEach((s) => {
      s.sprite.material.map?.dispose();
      s.sprite.material.dispose();
    });
  }
}

// ---------------------------------------------------------------- E
/**
 * A tilted 3D plate per word, lit and shaded through the ASCII shader (gives depth and presence),
 * with the word stamped on top as grid glyphs (stays legible at any size). Spacing grows like A.
 */
class PlateWords implements WordLayer {
  private readonly tracks = new BulletTracks();
  private readonly plates = new Map<string, THREE.Mesh>();
  private readonly geo = new THREE.BoxGeometry(1, 1, 1);
  /** Dim so the plate shades to light glyphs and the bright letters stand out. */
  private readonly mat = new THREE.MeshLambertMaterial({ color: 0x7a7a7a });

  constructor(private readonly scene: THREE.Scene) {}

  draw({ state, camera, text }: WordLayerCtx) {
    this.tracks.update(state);
    const alive = new Set(state.wordBullets.map((b) => b.id));
    for (const [id, m] of this.plates) {
      if (!alive.has(id)) {
        this.scene.remove(m);
        this.plates.delete(id);
      }
    }
    const { wordHeight, tilt, padX } = WORDS_PROTO;
    for (const b of state.wordBullets) {
      let plate = this.plates.get(b.id);
      if (!plate) {
        plate = new THREE.Mesh(this.geo, this.mat);
        this.scene.add(plate);
        this.plates.set(b.id, plate);
      }
      const n = [...b.word].length;
      this.tracks.position(b, plate.position);
      plate.position.z -= wordHeight * 0.3;
      plate.scale.set((n + 2 * padX) * ADVANCE * wordHeight, wordHeight * 1.5, wordHeight * 0.4);
      plate.rotation.x = -tilt;

      const p = projectToGrid(plate.position, camera);
      const step = Math.max(1, Math.round(ADVANCE * wordHeight * p.colsPerUnit));
      const first = Math.round(p.col - ((n - 1) * step) / 2);
      const matched = matchPrefix(state.typedWord, b.word);
      [...b.word].forEach((ch, i) => text.write(first + i * step, Math.round(p.row), ch, i < matched ? 'green' : 'fg'));
    }
  }

  dispose() {
    this.plates.forEach((m) => this.scene.remove(m));
    this.geo.dispose();
    this.mat.dispose();
  }
}
