import * as THREE from 'three';
import { ASCII_STYLE, fitToViewport } from '../render/asciiStyle';
import { GpuAsciiRenderer } from '../render/GpuAsciiRenderer';
import type { GameView } from './GameView';
import type { GameViewState, ViewEvent } from './GameViewState';
import { WordBulletSprites } from './words/WordBulletSprites';
import { WORD_FLIGHT } from './words/flightPath';
import { ENEMY_LOOK, EnemyShip } from './enemy/EnemyShip';
import { StarDrift } from './enemy/StarDrift';
import { Cockpit } from './cockpit/Cockpit';
import { WordDestroyFx } from './juice/WordDestroyFx';
import { HitFx } from './juice/HitFx';
import { mountPrototypeSwitcher } from '../prototypes/PrototypeSwitcher';
import { SHOT_HIT_PROTO, SHOT_HIT_VARIANTS, ShotHitFx, type ShotHitKind } from './juice/shotHitPrototype';

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
  /** PROTOTYPE ("Juice: Shot hit"): Radar HIT!! + enemy explosion / dip. */
  private readonly shotHitFx: ShotHitFx;
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
    this.shotHitFx = new ShotHitFx(this.scene, this.camera, this.enemy, this.cockpit.radar);
    SHOT_HIT_PROTO.kind = mountPrototypeSwitcher(SHOT_HIT_VARIANTS) as ShotHitKind; // PROTOTYPE
    this.overlay.add(this.words.scene, this.cockpit.overlay);
  }

  render(state: GameViewState, dt: number) {
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
    this.words.update(state, this.camera);
    this.hitFx.update(dt);
    this.destroyFx.update(dt, text); // before the Cockpit, so Cockpit text wins over grid bursts
    this.shotHitFx.update(dt, text);
    this.cockpit.update(state, dt, text);
    if (this.lastEvent) text.write(8, 2, this.lastEvent.label, 'dim');

    this.ascii.render(this.scene, this.camera, { scene: this.overlay, camera: this.camera });
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
    if (event.type === 'lifeLost') this.hitFx.shake();
    if (event.type === 'shotHit') this.shotHitFx.hit();
    const detail = 'id' in event ? ` ${event.id}` : 'word' in event ? ` ${event.word}` : '';
    this.lastEvent = { label: `${event.type}${detail}`, age: 0 };
  }

  resize(viewW: number, viewH: number, dpr: number) {
    const fit = fitToViewport(viewW, viewH, dpr);
    this.ascii.resize(fit);
    this.canvas.style.width = `${fit.canvasW / dpr}px`;
    this.canvas.style.height = `${fit.canvasH / dpr}px`;
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
    this.enemy.dispose();
    this.stars.dispose();
    this.ascii.dispose();
  }
}
