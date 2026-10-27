import * as THREE from 'three';
import opentype from 'opentype.js';
import plexWoff from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff?url';
import { ASCII_STYLE } from '../../render/asciiStyle';
import { matchPrefix } from '../../utils/matchPrefix';
import type { GameViewState } from '../GameViewState';
import { WordBulletTracks } from './flightPath';

/** PROTOTYPE ("Word bullets in flight" → word background): ?variant=A..D. */
export const WORD_STYLES = [
  { key: 'A', name: 'Rectangle backdrop (baseline)' },
  { key: 'B', name: 'Outline: thick black border around each letter' },
  { key: 'C', name: 'Shadow halo: soft dark glow around letters' },
  { key: 'D', name: '3D letters: extruded, lit, no ASCII filter' },
];
export type WordStyle = 'A' | 'B' | 'C' | 'D';

/** Live-tunable from the sandbox panel. */
export const WORD_LOOK = {
  /** Em size of a word in world units; perspective makes it grow as it nears the Cockpit. */
  height: 0.3,
  /** Rectangle backdrop padding (style A): x in letter widths, y in em. */
  padX: 1,
  padY: 0,
  /** PROTOTYPE: background style. */
  style: 'A' as WordStyle,
  /** Outline / halo thickness, in em (styles B, C). */
  border: 0.16,
  /** Extrusion depth in em (style D). */
  depth: 0.25,
};

/** Canvas px per em: high enough to stay crisp at the largest on-screen size. */
const EM_PX = 96;
const FONT = `400 ${EM_PX}px "${ASCII_STYLE.font.family}"`;
/** IBM Plex Mono advance width / em. */
const ADVANCE = 0.6;

type Sprite = { sprite: THREE.Sprite; canvas: HTMLCanvasElement; paintedKey: string; aspect: number };
type Mesh3D = { group: THREE.Group; matched: number; depth: number };

/**
 * Word bullets drawn over the ASCII frame (real font, not grid; "Words in the ASCII world").
 * Each bullet sits at its 3D flight position (steady path, see flightPath.ts), so it grows as it
 * nears the Cockpit; the nearest word draws on top. Target prefix in green. Arrival: vanishes.
 */
export class WordBulletSprites {
  /** Pass to AsciiRenderer.render() as the overlay scene. */
  readonly scene = new THREE.Scene();
  private readonly tracks = new WordBulletTracks();
  private readonly sprites = new Map<string, Sprite>();
  private readonly meshes = new Map<string, Mesh3D>();
  private readonly glyphs = new Map<string, THREE.BufferGeometry>();
  private readonly white = new THREE.MeshLambertMaterial({ color: 0xffffff });
  private readonly green = new THREE.MeshLambertMaterial({ color: ASCII_STYLE.palette.green });

  /** Loads the font outlines used by the 3D style. */
  static async create(): Promise<WordBulletSprites> {
    const font = opentype.parse(await (await fetch(plexWoff)).arrayBuffer());
    return new WordBulletSprites(font);
  }

  private constructor(private readonly font: opentype.Font) {
    // Lights only affect the 3D style; sprites are unlit.
    const { directional } = ASCII_STYLE.lighting;
    const sun = new THREE.DirectionalLight(0xffffff, 2.6);
    sun.position.set(...directional.position);
    this.scene.add(sun, new THREE.AmbientLight(0xffffff, 0.9));
  }

  update(state: GameViewState, camera: THREE.Camera) {
    this.tracks.update(state);
    const alive = new Set(state.wordBullets.map((b) => b.id));
    const use3D = WORD_LOOK.style === 'D';
    for (const [id, s] of this.sprites) if (!alive.has(id) || use3D) this.removeSprite(id, s);
    for (const [id, m] of this.meshes) if (!alive.has(id) || !use3D) this.removeMesh(id, m);

    for (const b of state.wordBullets) {
      const matched = matchPrefix(state.typedWord, b.word);
      if (use3D) {
        const m = this.mesh3D(b.id, b.word, matched);
        this.tracks.position(b, camera, m.group.position);
        m.group.quaternion.copy(camera.quaternion); // face the player
        m.group.scale.setScalar(WORD_LOOK.height);
        continue;
      }
      const s = this.sprites.get(b.id) ?? this.addSprite(b.id);
      const key = `${matched}|${WORD_LOOK.style}|${WORD_LOOK.padX}|${WORD_LOOK.padY}|${WORD_LOOK.border}`;
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

  // ---------------------------------------------------------------- sprites (A, B, C)

  private addSprite(id: string): Sprite {
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

  private removeSprite(id: string, s: Sprite) {
    this.scene.remove(s.sprite);
    s.sprite.material.map?.dispose();
    s.sprite.material.dispose();
    this.sprites.delete(id);
  }

  // ---------------------------------------------------------------- 3D letters (D)

  private mesh3D(id: string, word: string, matched: number): Mesh3D {
    let m = this.meshes.get(id);
    if (m && m.depth !== WORD_LOOK.depth) {
      this.removeMesh(id, m);
      m = undefined;
    }
    if (!m) {
      const group = new THREE.Group();
      const letters = [...word];
      letters.forEach((ch, i) => {
        const mesh = new THREE.Mesh(this.glyph(ch), this.white);
        mesh.position.set((i - letters.length / 2) * ADVANCE, -0.36, -WORD_LOOK.depth / 2);
        group.add(mesh);
      });
      this.scene.add(group);
      m = { group, matched: -1, depth: WORD_LOOK.depth };
      this.meshes.set(id, m);
    }
    if (m.matched !== matched) {
      m.group.children.forEach((c, i) => ((c as THREE.Mesh).material = i < matched ? this.green : this.white));
      m.matched = matched;
    }
    return m;
  }

  /** Glyph outline (em = 1, baseline at y = 0) → extruded geometry, cached per char + depth. */
  private glyph(ch: string) {
    const key = `${ch}|${WORD_LOOK.depth}`;
    let geo = this.glyphs.get(key);
    if (geo) return geo;
    const path = new THREE.ShapePath();
    for (const c of this.font.getPath(ch, 0, 0, 1).commands) {
      // opentype is y-down; three is y-up.
      if (c.type === 'M') path.moveTo(c.x, -c.y);
      else if (c.type === 'L') path.lineTo(c.x, -c.y);
      else if (c.type === 'Q') path.quadraticCurveTo(c.x1, -c.y1, c.x, -c.y);
      else if (c.type === 'C') path.bezierCurveTo(c.x1, -c.y1, c.x2, -c.y2, c.x, -c.y);
    }
    geo = new THREE.ExtrudeGeometry(path.toShapes(), { depth: WORD_LOOK.depth, bevelEnabled: false, curveSegments: 6 });
    this.glyphs.set(key, geo);
    return geo;
  }

  private removeMesh(id: string, m: Mesh3D) {
    this.scene.remove(m.group);
    this.meshes.delete(id);
  }

  dispose() {
    for (const [id, s] of this.sprites) this.removeSprite(id, s);
    for (const [id, m] of this.meshes) this.removeMesh(id, m);
    this.glyphs.forEach((g) => g.dispose());
    this.white.dispose();
    this.green.dispose();
  }
}

/**
 * Paints the word for the sprite styles. A: black rectangle backdrop. B: transparent, each letter
 * stroked with a thick black border. C: transparent, soft dark halo (layered shadows).
 * Matched letters green. Returns width / height.
 */
function paint(canvas: HTMLCanvasElement, letters: string[], matched: number) {
  const g = canvas.getContext('2d')!;
  g.font = FONT;
  const advance = g.measureText('M').width;
  const style = WORD_LOOK.style;
  const border = WORD_LOOK.border * EM_PX;
  const padX = style === 'A' ? WORD_LOOK.padX * advance : border * 1.6;
  const padY = style === 'A' ? WORD_LOOK.padY * EM_PX : border * 1.6;
  canvas.width = Math.ceil(advance * letters.length + 2 * padX);
  canvas.height = Math.ceil(EM_PX + 2 * padY);
  g.clearRect(0, 0, canvas.width, canvas.height);
  if (style === 'A') {
    g.fillStyle = ASCII_STYLE.palette.bg;
    g.fillRect(0, 0, canvas.width, canvas.height);
  }
  g.font = FONT; // resizing the canvas resets context state
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  const y = canvas.height / 2 + EM_PX * 0.05;
  const x = (i: number) => padX + i * advance;

  if (style === 'B') {
    g.strokeStyle = ASCII_STYLE.palette.bg;
    g.lineWidth = border * 2;
    letters.forEach((ch, i) => g.strokeText(ch, x(i), y));
  } else if (style === 'C') {
    g.shadowColor = 'rgba(0,0,0,1)';
    g.shadowBlur = border;
    g.fillStyle = ASCII_STYLE.palette.bg;
    for (let k = 0; k < 4; k++) letters.forEach((ch, i) => g.fillText(ch, x(i), y)); // stack shadows → denser halo
    g.shadowBlur = 0;
  }
  letters.forEach((ch, i) => {
    g.fillStyle = i < matched ? ASCII_STYLE.palette.green : ASCII_STYLE.palette.fg;
    g.fillText(ch, x(i), y);
  });
  return canvas.width / canvas.height;
}
