import type { TextGrid } from '../render/AsciiRenderer';
import type { GameViewState, ViewEvent } from './GameViewState';

/**
 * The game-specific scene: Enemy ship, Cockpit, Word bullets, effects.
 * Draws through an AsciiRenderer. Used identically by the sandbox and the real game.
 * Never reads input; never runs its own frame loop (the app shell calls render()).
 */
export interface GameView {
  /** Canvas the app shell mounts in the page. */
  readonly canvas: HTMLCanvasElement;
  /**
   * Draw one frame. `dt` (seconds) drives the view's own animations.
   * Targets (green prefix) are computed here with `matchPrefix(state.typedWord, bullet.word)`.
   */
  render(state: GameViewState, dt: number): void;
  /** Start the animation for a one-off moment. */
  trigger(event: ViewEvent): void;
  /**
   * Show a text screen (menu, how-to, waiting...) instead of the game scene: while `draw` is set, `render()` hides
   * the scene, clears the text grid and calls `draw(text, dt)` before the ASCII pass (so the CRT filters apply).
   * Pass null to go back to the game scene.
   */
  setScreen(draw: ((text: TextGrid, dt: number) => void) | null): void;
  /**
   * Draw extra text over the game scene (e.g. the GO flash). `draw` runs every frame after the scene's own text,
   * before the ASCII pass. Pass null to remove it.
   */
  setOverlay(draw: ((text: TextGrid, dt: number) => void) | null): void;
  /**
   * Re-fit to the viewport (CSS px + devicePixelRatio): fixed 128×45 grid, cells via
   * fitToViewport(), camera aspect = real canvas aspect. Rebuilds glyph atlas and render targets.
   */
  resize(viewW: number, viewH: number, dpr: number): void;
  dispose(): void;
}
