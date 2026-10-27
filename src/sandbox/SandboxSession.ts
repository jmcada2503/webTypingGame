import type { GameSession, SessionStatus } from '../app/GameSession';
import type { TypingInput } from '../input/TypingInput';
import type { GameViewState, ViewEvent, WordBulletState } from '../view/GameViewState';

/** Spanish sample words, 1–20 chars, lowercase + ñ / accents. */
export const SAMPLE_WORDS = [
  'sol', 'luna', 'ñandú', 'murciélago', 'camión', 'pingüino', 'año', 'otorrinolaringólogo',
  'estrella', 'cañón', 'nave', 'órbita', 'cohete', 'galaxia', 'piñata', 'reloj', 'jabalí', 'electroencefalograma',
];

/**
 * Tweak-panel driven GameSession for the visual sandbox. No real mechanics: arrivals cost
 * no Lives. Sandbox shortcut (toggle `submitDestroys`): submitting a word destroys the
 * closest Word bullet with exactly that word, so any bullet can be destroyed, not just the oldest.
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
  /** Submitting a word destroys the matching Word bullet. */
  submitDestroys = true;

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
      input.onSubmit((w) => this.onSubmit(w)),
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

  spawn(word = SAMPLE_WORDS[Math.floor(Math.random() * SAMPLE_WORDS.length)], flight = 0) {
    const id = `b${this.nextId++}`;
    this.bullets.push({ id, word, flight });
    this.pending.push({ type: 'enemyFired', id });
  }

  /** Destroy one Word bullet by id. */
  destroy(id: string) {
    if (this.bullets.some((b) => b.id === id)) this.remove(id, 'wordBulletDestroyed');
  }

  destroyOldest() {
    const b = this.bullets[0];
    if (b) this.destroy(b.id);
  }

  destroyNewest() {
    const b = this.bullets.at(-1);
    if (b) this.destroy(b.id);
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

  private onSubmit(word: string) {
    this.lastSubmitted = word;
    if (!this.submitDestroys) return;
    const typed = word.normalize('NFC');
    // Several bullets may carry the same word: take the one closest to the Cockpit.
    const hit = this.bullets
      .filter((b) => b.word.normalize('NFC') === typed)
      .sort((a, b) => b.flight - a.flight)[0];
    if (hit) this.destroy(hit.id);
  }

  private remove(id: string, type: 'wordBulletDestroyed' | 'wordBulletArrived') {
    this.bullets = this.bullets.filter((b) => b.id !== id);
    this.pending.push({ type, id });
  }
}
