import { drawNoKeyboard } from '../screens/noKeyboardScreen';
import type { GameView } from '../view/GameView';
import { NOT_IDLE, type GameViewState } from '../view/GameViewState';

const BLANK: GameViewState = { lives: 3, typedWord: '', attackWord: '', wordBullets: [], shots: [], enemyDamage: 0, pace: { player: 0, enemy: 0 }, idle: NOT_IDLE };

/**
 * Show the "needs a physical keyboard" screen on `view` until a real key is pressed, then hand the view back
 * (screen cleared, canvas unmounted) for the app shell to mount.
 */
export function runKeyboardGate(view: GameView): Promise<void> {
  return new Promise((resolve) => {
    document.body.classList.add('app-root');
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', fit);
      view.setScreen(null);
      view.canvas.remove();
      document.body.classList.remove('app-root');
      resolve();
    };
    view.setScreen((text) => drawNoKeyboard(text, t));
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('keydown', onKey);
    frame = requestAnimationFrame(tick);
  });
}
