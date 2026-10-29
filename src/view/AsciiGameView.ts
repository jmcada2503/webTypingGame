import * as THREE from 'three';
import { ASCII_STYLE, fitToViewport } from '../render/asciiStyle';
import type { TextGrid } from '../render/AsciiRenderer';
import { GpuAsciiRenderer } from '../render/GpuAsciiRenderer';
import type { GameView } from './GameView';
import type { GameViewState, ViewEvent } from './GameViewState';
import { WordBulletSprites } from './words/WordBulletSprites';
import { WORD_FLIGHT } from './words/flightPath';
import { ENEMY_LOOK, EnemyShip } from './enemy/EnemyShip';
import { StarDrift } from './enemy/StarDrift';
import { Cockpit } from './cockpit/Cockpit';
import { WordDestroyFx } from './juice/WordDestroyFx';
import { HIT_LOOK, HitFx } from './juice/HitFx';
import { ShotHitFx } from './juice/ShotHitFx';
import { EnemyDamageFx } from './juice/EnemyDamageFx';
import { SparkBursts } from './juice/SparkBursts';
import { AttackSparks } from './juice/AttackSparks';
import { PaceMotion } from './juice/PaceMotion';
import { SCREEN_HIT } from '../render/ScreenFilters';
import { worldToGrid } from './cockpit/gridProjection';
import { matchPrefix } from '../utils/matchPrefix';

const EVENT_LABEL_SECONDS = 1.2;

/**
 * Skeleton GameView. Placeholders until the visual tickets replace them:
 * - ViewEvents shown as a dim label top left (juice tickets)
 */
export class AsciiGameView implements GameView {
  readonly canvas: HTMLCanvasElement;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);
  /** Enemy ship (the dart) + stars flying past ("Enemy ship and space backdrop"). */
  private readonly enemy = new EnemyShip();
  private readonly stars = new StarDrift();
  private lastEvent: { label: string; age: number } | null = null;
  /** The player's Cockpit: yoke, Lives lamps, Radar ("Cockpit design"). */
  private readonly cockpit: Cockpit;
  /** Destroyed Word bullets break into flying letters + a green grid ring. */
  private readonly destroyFx: WordDestroyFx;
  /** Hit taken: red debris at the impact point + camera jitter on a life lost. */
  private readonly hitFx: HitFx;
  /** Shot hit: Radar HIT!! + big green explosion on the Enemy ship, which sags. */
  private readonly shotHitFx: ShotHitFx;
  /** Enemy ship damage: smoke + missing pieces from enemyDamage. */
  private readonly damageFx: EnemyDamageFx;
  /** Yellow firing sparks (Enemy ship fires, Attack word fired). */
  private readonly sparks = new SparkBursts();
  /** Big yellow 3D sparks from behind the Cockpit when the Attack word is fired. */
  private readonly attackSparks: AttackSparks;
  private readonly paceMotion: PaceMotion;
  /** Typed word last frame, to spot correct / wrong keys. */
  private prevTyped = '';
  /** Drawn after the ASCII pass, untouched: Word bullets + real-font Cockpit labels. */
  private readonly overlay = new THREE.Scene();
  /** Word bullets: real-font sprites over the ASCII frame ("Words in the ASCII world"). */
  /** Word bullets: real-font, outlined, over the ASCII frame. */
  private readonly words = new WordBulletSprites();

  static async create(): Promise<AsciiGameView> {
    return new AsciiGameView(await GpuAsciiRenderer.create());
  }

  private constructor(private readonly ascii: GpuAsciiRenderer) {
    this.canvas = ascii.canvas;
    const { directional, ambient } = ASCII_STYLE.lighting;
    const sun = new THREE.DirectionalLight(0xffffff, directional.intensity);
    sun.position.set(...directional.position);
    this.scene.add(sun, new THREE.AmbientLight(0xffffff, ambient));

    this.camera.position.set(0, 0, 7);
    this.scene.add(this.enemy.root, this.stars.points);
    this.cockpit = new Cockpit(this.scene, this.camera);
    this.destroyFx = new WordDestroyFx(this.overlay, this.camera);
    this.hitFx = new HitFx(this.scene, this.camera);
    this.shotHitFx = new ShotHitFx(this.camera, this.enemy, this.cockpit.radar);
    this.damageFx = new EnemyDamageFx(this.enemy, this.camera);
    this.attackSparks = new AttackSparks(this.scene, this.camera);
    this.paceMotion = new PaceMotion(this.enemy);
    this.overlay.add(this.words.scene, this.cockpit.overlay);
  }

  /** A text screen to draw instead of the game scene (null = the game scene). */
  private screenDraw: ((text: TextGrid, dt: number) => void) | null = null;
  private overlayDraw: ((text: TextGrid, dt: number) => void) | null = null;
  /** Show the last ViewEvent's name as a dim label at the top left: a debugging aid for the sandbox. */
  debugEventLabel = false;

  setScreen(draw: ((text: TextGrid, dt: number) => void) | null) {
    this.screenDraw = draw;
  }

  setOverlay(draw: ((text: TextGrid, dt: number) => void) | null) {
    this.overlayDraw = draw;
  }

  render(state: GameViewState, dt: number) {
    if (this.screenDraw) return this.renderScreen(this.screenDraw, dt);
    this.scene.visible = true;
    this.overlay.visible = true;
    this.enemy.update(dt);
    this.stars.update(dt);
    // Word bullets leave from the Enemy ship's center (its resting spot, so bobbing doesn't jerk words in flight).
    WORD_FLIGHT.start.y = ENEMY_LOOK.position.y - 1;
    WORD_FLIGHT.start.z = ENEMY_LOOK.position.z + 2;
    if (this.lastEvent && (this.lastEvent.age += dt) > EVENT_LABEL_SECONDS) this.lastEvent = null;

    const text = this.ascii.textGrid;
    text.clear();
    // Place Word bullets with the camera at rest, then shake: words shake with the world.
    this.hitFx.resetCamera();
    this.typingFeedback(state);
    this.words.update(state, this.camera, dt);
    this.hitFx.update(dt);
    SCREEN_HIT.level = Math.max(0, SCREEN_HIT.level - dt / HIT_LOOK.flashSeconds);
    this.destroyFx.update(dt, text); // before the Cockpit, so Cockpit text wins over grid bursts
    this.shotHitFx.update(dt, text);
    this.paceMotion.update(state.pace, dt);
    this.damageFx.update(state.enemyDamage, dt, text);
    this.sparks.update(dt, text);
    this.attackSparks.update(dt);
    this.cockpit.update(state, dt, text);
    if (this.debugEventLabel && this.lastEvent) text.write(8, 2, this.lastEvent.label, 'dim');
    this.overlayDraw?.(text, dt);

    this.ascii.render(this.scene, this.camera, { scene: this.overlay, camera: this.camera });
  }

  private renderScreen(draw: (text: TextGrid, dt: number) => void, dt: number) {
    this.scene.visible = false;
    this.overlay.visible = false;
    const text = this.ascii.textGrid;
    text.clear();
    draw(text, dt);
    this.ascii.render(this.scene, this.camera, { scene: this.overlay, camera: this.camera });
  }

  /**
   * A key was added to the Typed word: if it still starts some Word bullet, those Targets' next
   * letter pulses; if it fits no Word bullet and isn't part of the Attack word, the Typed word shakes.
   */
  private typingFeedback(state: GameViewState) {
    const typed = state.typedWord;
    const added = typed.length > this.prevTyped.length && typed.startsWith(this.prevTyped);
    this.prevTyped = typed;
    if (!added) return;
    const len = [...typed].length;
    const targets = state.wordBullets.filter((b) => matchPrefix(typed, b.word) === len);
    targets.forEach((b) => this.words.pulse(b.id));
    if (targets.length === 0 && matchPrefix(typed, state.attackWord) !== len) {
      this.cockpit.shakeTyped();
      this.hitFx.noShake();
    }
  }

  trigger(event: ViewEvent) {
    if (event.type === 'wordBulletDestroyed') {
      const snap = this.words.take(event.id);
      if (snap) this.destroyFx.burst(snap);
    }
    if (event.type === 'wordBulletArrived') {
      // The word vanishes; a red explosion goes off where it hit.
      const snap = this.words.take(event.id);
      if (snap) this.hitFx.explode(snap.center);
    }
    if (event.type === 'lifeLost') {
      this.hitFx.shake();
      SCREEN_HIT.level = 1;
    }
    if (event.type === 'shotHit') this.shotHitFx.hit();
    if (event.type === 'shotDefended') this.cockpit.radar.defended(event.id);
    if (event.type === 'enemyFired') {
      // The ship flashes and throws a ring of yellow sparks from where words launch.
      this.enemy.flash();
      const g = worldToGrid(this.enemy.root.position, this.camera);
      this.sparks.burst(g.col, g.row, { count: 10, reach: 2.5 });
    }
    if (event.type === 'attackFired') {
      // Big yellow sparks burst from behind the Cockpit's center toward the Enemy ship.
      this.attackSparks.fire(this.enemy.root.position);
    }
    const detail = 'id' in event ? ` ${event.id}` : 'word' in event ? ` ${event.word}` : '';
    this.lastEvent = { label: `${event.type}${detail}`, age: 0 };
  }

  resize(viewW: number, viewH: number, dpr: number) {
    const fit = fitToViewport(viewW, viewH, dpr);
    this.ascii.resize(fit);
    this.canvas.style.width = `${fit.cssW}px`;
    this.canvas.style.height = `${fit.cssH}px`;
    // Integer cells can't keep 10:16 exactly: match the camera to the real canvas so nothing is squashed.
    this.camera.aspect = fit.canvasW / fit.canvasH;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.words.dispose();
    this.cockpit.dispose();
    this.destroyFx.dispose();
    this.hitFx.dispose();
    this.shotHitFx.dispose();
    this.damageFx.dispose();
    this.attackSparks.dispose();
    this.enemy.dispose();
    this.stars.dispose();
    this.ascii.dispose();
  }
}
