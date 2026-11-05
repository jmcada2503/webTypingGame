import type { TextGrid } from '../render/AsciiRenderer';
import type { GameView } from '../view/GameView';
import { NOT_IDLE, type GameViewState } from '../view/GameViewState';

const BLANK: GameViewState = { lives: 3, typedWord: '', attackWord: '', wordBullets: [], shots: [], enemyDamage: 0, pace: { player: 0, enemy: 0 }, idle: NOT_IDLE };

/**
 * Show a screen on `view` before the game starts, until `onKey` returns true; then hand the view back (screen
 * cleared, canvas unmounted) for the app shell to mount. `draw` gets the seconds since the screen showed.
 * Modifier keys pressed alone never reach `onKey`.
 */
export function runGateScreen(view: GameView, draw: (text: TextGrid, t: number) => void, onKey: (e: KeyboardEvent) => boolean): Promise<void> {
  return new Promise((resolve) => {
    document.body.classList.add('app-root');
    document.documentElement.classList.add('game-ready'); // the page's crawlable text gives way
    document.body.prepend(view.canvas);
    const fit = () => view.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
    let t = 0;
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      t += dt;
      view.render(BLANK, dt);
      frame = requestAnimationFrame(tick);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
      if (!onKey(e)) return;
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', key);
      window.removeEventListener('resize', fit);
      view.setScreen(null);
      view.canvas.remove();
      document.body.classList.remove('app-root');
      resolve();
    };
    view.setScreen((text) => draw(text, t));
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('keydown', key);
    frame = requestAnimationFrame(tick);
  });
}
