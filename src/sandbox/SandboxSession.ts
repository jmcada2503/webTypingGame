import type { GameSession, SessionStatus } from '../app/GameSession';
import type { TypingInput } from '../input/TypingInput';
import type { GameViewState, ShotState, ViewEvent, WordBulletState } from '../view/GameViewState';

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
  /** An arriving Word bullet takes a life (and emits lifeLost). */
  arrivalCostsLife = true;
  /** Seconds for a Shot to reach the Enemy ship. */
  shotFlightSeconds = 5;
  /** After firing, the Attack word changes to a random sample word. */
  newAttackWordOnFire = true;
  /** Enemy ship damage, 0..1 (panel slider). */
  enemyDamage = 0;
  /** Sandbox shortcut: each Shot that hits adds this much damage (0 = off). */
  damagePerHit = 0.5;

  private typed = '';
  private bullets: WordBulletState[] = [];
  private shots: ShotState[] = [];
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
      for (const s of this.shots) s.flight += advance / this.shotFlightSeconds;
      for (const s of this.shots.filter((s) => s.flight >= 1)) this.removeShot(s.id, 'shotHit');
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
      shots: this.shots.map((s) => ({ ...s })),
      enemyDamage: this.enemyDamage,
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

  /** Fire the current Attack word as a Shot. */
  fireAttack() {
    const id = `s${this.nextId++}`;
    this.shots.push({ id, word: this.attackWord, flight: 0 });
    this.pending.push({ type: 'attackFired', id, word: this.attackWord });
    if (this.newAttackWordOnFire) {
      const others = SAMPLE_WORDS.filter((w) => w !== this.attackWord);
      this.attackWord = others[Math.floor(Math.random() * others.length)];
    }
  }

  /** The oldest Shot reaches the Enemy ship now. */
  hitOldestShot() {
    const s = this.shots[0];
    if (s) this.removeShot(s.id, 'shotHit');
  }

  /** The opponent destroys the oldest Shot. */
  defendOldestShot() {
    const s = this.shots[0];
    if (s) this.removeShot(s.id, 'shotDefended');
  }

  get shotCount() {
    return this.shots.length;
  }

  private removeShot(id: string, type: 'shotHit' | 'shotDefended') {
    this.shots = this.shots.filter((s) => s.id !== id);
    this.pending.push({ type, id });
    if (type === 'shotHit') this.enemyDamage = Math.min(1, this.enemyDamage + this.damagePerHit);
  }

  private onSubmit(word: string) {
    this.lastSubmitted = word;
    if (word.normalize('NFC') === this.attackWord.normalize('NFC')) {
      this.fireAttack();
      return;
    }
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
    // Sandbox shortcut (not the real rule): an arrival costs a life when enabled.
    if (type === 'wordBulletArrived' && this.arrivalCostsLife && this.lives > 0) {
      this.lives--;
      this.pending.push({ type: 'lifeLost' });
    }
  }

  refillLives() {
    this.lives = 3;
  }
}
