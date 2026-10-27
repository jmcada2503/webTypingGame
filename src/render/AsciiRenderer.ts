import type { Camera, Scene } from 'three';
import type { ViewportFit } from './asciiStyle';

export type PaletteColor = 'fg' | 'red' | 'green' | 'dim';

/**
 * Grid-locked text drawn on top of the shaded cells, same font and cell as the shading.
 * Used for the Cockpit screens (Lives, Typed word, Attack word). Coordinates: col 0 = left, row 0 = top.
 */
export interface TextGrid {
  readonly cols: number;
  readonly rows: number;
  write(col: number, row: number, text: string, color?: PaletteColor): void;
  /** Fill a rectangle with one character (' ' blanks the shading underneath). */
  fill(col: number, row: number, width: number, height: number, char?: string, color?: PaletteColor): void;
  clear(): void;
}

/**
 * Generic ASCII engine: renders a three.js scene as characters (luminance → ramp, no edge glyphs),
 * then composites the TextGrid on top. Knows nothing about the game.
 * Implementations: GPU (WebGL2 shader pipeline, primary); CPU 2D-canvas (fallback, if ever needed).
 */
export interface AsciiRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly textGrid: TextGrid;
  /** Rebuild glyph atlas + render targets for a new fit. */
  resize(fit: ViewportFit): void;
  /**
   * Render `scene` through the ASCII pipeline. `overlay`, if given, is drawn after the ASCII pass
   * with no ASCII treatment (e.g. smoothly scaling Word bullet text; final shape decided in
   * "Words in the ASCII world").
   */
  render(scene: Scene, camera: Camera, overlay?: { scene: Scene; camera: Camera }): void;
  dispose(): void;
}
