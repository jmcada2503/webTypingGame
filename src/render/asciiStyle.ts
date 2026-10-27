/**
 * Locked ASCII look, from the "ASCII aesthetic: rotating cube" prototype
 * (https://github.com/jmcada2503/webTypingGame/issues/3).
 *
 * Rendering: three.js WebGL2 + custom GPU ASCII pass. Each cell's glyph is picked
 * from RAMP by the cell's average luminance. No edge glyphs (rejected in the prototype).
 */
export const ASCII_STYLE = {
  /** Fixed canvas, CSS px. No resize. */
  canvas: { width: 1280, height: 720 },
  /** Cell size, CSS px → 128×45 grid. */
  cell: { width: 10, height: 16 },
  font: { family: 'IBM Plex Mono', sizePx: 13 },
  /** Dark → bright. Index 0 (space) is background. */
  ramp: ' .,-~:;=!*#$@',
  luminance: { exposure: 1, gamma: 1 },
  edges: false,
  palette: {
    fg: '#ffffff',
    bg: '#000000',
    /** Attack word, damage. */
    red: '#ff3b30',
    /** Typed-word prefix match. */
    green: '#34c759',
    dim: '#5a5a5a',
  },
  lighting: {
    /** MeshLambertMaterial, white. Smooth shading by default; flat allowed per model as a style choice. */
    directional: { position: [-1, 1.2, 1] as const, intensity: 4.23 },
    ambient: 0.25,
    flatShadingDefault: false,
  },
} as const;

export const GRID = {
  cols: ASCII_STYLE.canvas.width / ASCII_STYLE.cell.width,
  rows: ASCII_STYLE.canvas.height / ASCII_STYLE.cell.height,
} as const;
