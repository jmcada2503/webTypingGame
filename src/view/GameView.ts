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
   * Re-fit to the viewport (CSS px + devicePixelRatio): fixed 128×45 grid, cells via
   * fitToViewport(), camera aspect = real canvas aspect. Rebuilds glyph atlas and render targets.
   */
  resize(viewW: number, viewH: number, dpr: number): void;
  dispose(): void;
}
