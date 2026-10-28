/**
 * Locked ASCII look, from the "ASCII aesthetic: rotating cube" prototype
 * (https://github.com/jmcada2503/webTypingGame/issues/3).
 *
 * Rendering: three.js WebGL2 + custom GPU ASCII pass. Each cell's glyph is picked
 * from RAMP by the cell's average luminance. No edge glyphs (rejected in the prototype).
 *
 * Sizing: the GRID is fixed (128×45 cells, 16:9) on every screen. Cells scale to fit
 * the window (letterboxed), so layout is identical for all players and glyphs stay crisp
 * because the atlas is rebuilt at the real cell size. See fitToViewport().
 */
export const ASCII_STYLE = {
  /** Fixed character grid, every screen. */
  grid: { cols: 128, rows: 45 },
  /** Reference cell, CSS px (at 1280×720). Real size comes from fitToViewport(). */
  referenceCell: { width: 10, height: 16 },
  /** Font size = cell height × this (13px at a 16px cell). */
  font: { family: 'IBM Plex Mono', sizeToCellHeight: 13 / 16 },
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
    /** Firing sparks (Enemy ship firing, Attack word fired). */
    yellow: '#ffcc00',
  },
  lighting: {
    /** MeshLambertMaterial, white. Smooth shading by default; flat allowed per model as a style choice. */
    directional: { position: [-1, 1.2, 1] as const, intensity: 4.23 },
    ambient: 0.25,
    flatShadingDefault: false,
  },
} as const;

export type ViewportFit = {
  /** Cell size in device px (integers → crisp glyphs). */
  cellW: number;
  cellH: number;
  /** Font size in device px for the glyph atlas. */
  fontPx: number;
  /** Drawing-buffer size in device px (= grid × cell). */
  canvasW: number;
  canvasH: number;
  /** Size the canvas is shown at, in CSS px (bigger than canvas / dpr when the buffer is capped). */
  cssW: number;
  cssH: number;
};

/**
 * Largest drawing buffer (device px, wide side): 4K. Measured ("Performance budget"): 4K holds
 * 60 fps with 60+ Word bullets and every effect at once; 5K (5120×2880) drops to 40–58 fps.
 * Bigger screens draw at this size and the browser scales the canvas up.
 */
export const MAX_CANVAS_WIDTH = 3840;

/** Largest integer cell (keeping the reference 10:16 ratio) whose grid fits the viewport. */
export function fitToViewport(viewW: number, viewH: number, dpr: number): ViewportFit {
  const { grid, referenceCell, font } = ASCII_STYLE;
  const kFit = Math.min((viewW * dpr) / (grid.cols * referenceCell.width), (viewH * dpr) / (grid.rows * referenceCell.height));
  const k = Math.min(kFit, MAX_CANVAS_WIDTH / (grid.cols * referenceCell.width));
  const cellW = Math.max(1, Math.floor(referenceCell.width * k));
  const cellH = Math.max(1, Math.floor(referenceCell.height * k));
  const canvasW = cellW * grid.cols;
  const canvasH = cellH * grid.rows;
  // When capped, show the smaller buffer scaled up to the room the screen allows.
  const scale = kFit > k ? kFit / k : 1;
  return { cellW, cellH, fontPx: cellH * font.sizeToCellHeight, canvasW, canvasH, cssW: (canvasW * scale) / dpr, cssH: (canvasH * scale) / dpr };
}
