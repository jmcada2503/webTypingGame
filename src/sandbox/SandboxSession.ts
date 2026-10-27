import type { GameSession, SessionStatus } from '../app/GameSession';
import type { TypingInput } from '../input/TypingInput';
import type { GameViewState, ViewEvent, WordBulletState } from '../view/GameViewState';

/** Spanish sample words, 1–20 chars, lowercase + ñ / accents. */
export const SAMPLE_WORDS = [
  'sol', 'luna', 'ñandú', 'murciélago', 'camión', 'pingüino', 'año', 'otorrinolaringólogo',
  'estrella', 'cañón', 'nave', 'órbita', 'cohete', 'galaxia', 'piñata', 'reloj', 'jabalí', 'electroencefalograma',
];

/**
 * Tweak-panel driven GameSession for the visual sandbox. No mechanics: typing never
 * destroys a Word bullet and arrivals cost no Lives. Every change comes from the panel.
 */
export class SandboxSession implements GameSession {
  status: SessionStatus = 'idle';

  // Panel-bound knobs (lil-gui edits these fields directly).
  lives = 3;
  attackWord = 'ñandú';
  /** Seconds for a Word bullet to go from Flight 0 to 1. */
  flightSeconds = 6;
  paused = false;
  autoSpawn = false;
  /** Seconds between auto-spawned Word bullets. */
  spawnEvery = 1.5;
  lastSubmitted = '';

  private typed = '';
  private bullets: WordBulletState[] = [];
  private pending: ViewEvent[] = [];
  private nextId = 1;
  private spawnTimer = 0;
  private stepOnce = false;
  private unsubs: (() => void)[] = [];

  start() {
    this.status = 'running';
  }

  dispose() {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.status = 'idle';
  }

  attachInput(input: TypingInput) {
    this.typed = input.typedWord;
    this.unsubs.push(
      input.onChange((w) => (this.typed = w)),
      input.onSubmit((w) => (this.lastSubmitted = w)),
    );
  }

  update(dt: number): ViewEvent[] {
    const advance = this.paused ? (this.stepOnce ? 1 / 60 : 0) : dt;
    this.stepOnce = false;
    if (advance > 0) {
      for (const b of this.bullets) b.flight += advance / this.flightSeconds;
      for (const b of this.bullets.filter((b) => b.flight >= 1)) this.remove(b.id, 'wordBulletArrived');
      if (this.autoSpawn && (this.spawnTimer += advance) >= this.spawnEvery) {
        this.spawnTimer = 0;
        this.spawn();
      }
    }
    const events = this.pending;
    this.pending = [];
    return events;
  }

  state(): GameViewState {
    return {
      lives: this.lives,
      typedWord: this.typed,
      attackWord: this.attackWord,
      wordBullets: this.bullets.map((b) => ({ ...b })),
    };
  }

  get bulletCount() {
    return this.bullets.length;
  }

  // ---- panel actions ----

  /** While paused, advance one 60fps frame. */
  step() {
    this.stepOnce = true;
  }

  spawn(word = SAMPLE_WORDS[Math.floor(Math.random() * SAMPLE_WORDS.length)]) {
    const id = `b${this.nextId++}`;
    this.bullets.push({ id, word, flight: 0 });
    this.pending.push({ type: 'enemyFired', id });
  }

  destroyOldest() {
    const b = this.bullets[0];
    if (b) this.remove(b.id, 'wordBulletDestroyed');
  }

  arriveOldest() {
    const b = this.bullets[0];
    if (b) this.remove(b.id, 'wordBulletArrived');
  }

  clearBullets() {
    this.bullets = [];
  }

  emit(event: ViewEvent) {
    this.pending.push(event);
  }

  private remove(id: string, type: 'wordBulletDestroyed' | 'wordBulletArrived') {
    this.bullets = this.bullets.filter((b) => b.id !== id);
    this.pending.push({ type, id });
  }
}
