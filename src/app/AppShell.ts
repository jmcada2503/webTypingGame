import type { TypingInput } from '../input/TypingInput';
import type { GameView } from '../view/GameView';
import { onFullscreenChange, toggleFullscreen } from './fullscreen';
import type { GameSession } from './GameSession';

/** Longest frame step; a hidden tab or debugger pause shouldn't teleport Word bullets. */
const MAX_DT = 0.1;
const RESIZE_DEBOUNCE_MS = 100;

/**
 * Owns the page: mounts the view's canvas (centered, letterboxed on black), runs the frame loop,
 * re-fits on resize / fullscreen, and toggles fullscreen when asked (the game binds it to the F key).
 *
 * Each frame: events = session.update(dt); events.forEach(view.trigger); view.render(session.state(), dt)
 */
export class AppShell {
  private frame = 0;
  private last = 0;
  private resizeTimer = 0;
  private readonly cleanups: (() => void)[] = [];
  private readonly toast = document.createElement('div');

  constructor(
    private readonly view: GameView,
    private readonly session: GameSession,
    private readonly input: TypingInput,
    private readonly root: HTMLElement = document.body,
  ) {}

  start() {
    this.root.classList.add('app-root');
    this.root.prepend(this.view.canvas);
    this.mountToast();
    this.fit();

    const onResize = () => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => this.fit(), RESIZE_DEBOUNCE_MS);
    };
    window.addEventListener('resize', onResize);
    this.cleanups.push(() => window.removeEventListener('resize', onResize));
    this.cleanups.push(
      onFullscreenChange(() => this.fit()),
    );

    this.session.attachInput(this.input);
    this.session.start();
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  async toggleFullscreen() {
    const error = await toggleFullscreen();
    if (error) this.say(error);
  }

  private readonly tick = (now: number) => {
    const dt = Math.min((now - this.last) / 1000, MAX_DT);
    this.last = now;
    const events = this.session.update(dt);
    events.forEach((e) => this.view.trigger(e));
    this.view.render(this.session.state(), dt);
    this.frame = requestAnimationFrame(this.tick);
  };

  private fit() {
    this.view.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
  }

  /** A short message at the top when the browser refuses fullscreen. */
  private mountToast() {
    this.toast.className = 'toast';
    this.toast.hidden = true;
    this.root.append(this.toast);
  }

  private say(msg: string) {
    this.toast.textContent = msg;
    this.toast.hidden = false;
    window.setTimeout(() => (this.toast.hidden = true), 4000);
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    clearTimeout(this.resizeTimer);
    this.cleanups.forEach((c) => c());
    this.toast.remove();
    this.session.dispose();
    this.input.dispose();
    this.view.dispose();
    this.view.canvas.remove();
  }
}
