import * as THREE from 'three';
import { ASCII_STYLE, fitToViewport } from '../render/asciiStyle';
import { GpuAsciiRenderer } from '../render/GpuAsciiRenderer';
import type { GameView } from './GameView';
import type { GameViewState, ViewEvent } from './GameViewState';
import { WordBulletSprites } from './words/WordBulletSprites';
import { WORD_FLIGHT } from './words/flightPath';
import { mountPrototypeSwitcher } from '../prototypes/PrototypeSwitcher';
import { ENEMY_PROTO, ENEMY_VARIANTS, EnemyAndBackdrop } from './enemyPrototype/variants';

const MAX_LIVES = 3;
const EVENT_LABEL_SECONDS = 1.2;

/**
 * Skeleton GameView. Placeholders until the visual tickets replace them:
 * - Enemy ship + backdrop: PROTOTYPE variants via ?variant= ("Enemy ship and space backdrop")
 * - Cockpit readouts as one text row ("Cockpit design")
 * - ViewEvents shown as a label top center (juice tickets)
 */
export class AsciiGameView implements GameView {
  readonly canvas: HTMLCanvasElement;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);
  private readonly enemy: EnemyAndBackdrop;
  private lastEvent: { label: string; age: number } | null = null;
  /** Word bullets: real-font sprites over the ASCII frame ("Words in the ASCII world"). */
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
    const preset = ENEMY_VARIANTS.find((v) => v.key === mountPrototypeSwitcher([...ENEMY_VARIANTS]))!;
    ENEMY_PROTO.ship = preset.ship;
    ENEMY_PROTO.backdrop = preset.backdrop;
    this.enemy = new EnemyAndBackdrop(this.scene, this.camera);
  }

  render(state: GameViewState, dt: number) {
    this.enemy.update(dt);
    // Word bullets leave from the Enemy ship (its resting spot, so bobbing doesn't jerk words in flight).
    WORD_FLIGHT.start.y = ENEMY_PROTO.position.y - 1;
    WORD_FLIGHT.start.z = ENEMY_PROTO.position.z + 2;
    if (this.lastEvent && (this.lastEvent.age += dt) > EVENT_LABEL_SECONDS) this.lastEvent = null;

    const text = this.ascii.textGrid;
    text.clear();
    this.words.update(state);
    this.drawCockpit(state);
    if (this.lastEvent) text.write(Math.floor((text.cols - this.lastEvent.label.length) / 2), text.rows - 6, this.lastEvent.label, 'dim');

    this.ascii.render(this.scene, this.camera, { scene: this.words.scene, camera: this.camera });
  }

  private drawCockpit(state: GameViewState) {
    const text = this.ascii.textGrid;
    const row = text.rows - 3;
    text.fill(0, row - 1, text.cols, 3, ' ');
    text.write(2, row, 'LIVES ', 'dim');
    for (let i = 0; i < MAX_LIVES; i++) text.write(8 + i, row, '♥', i < state.lives ? 'red' : 'dim');
    const typed = `> ${state.typedWord}_`;
    text.write(Math.floor(text.cols / 2 - [...typed].length / 2), row, typed, 'fg');
    text.write(text.cols - [...state.attackWord].length - 2, row, state.attackWord, 'red');
  }

  trigger(event: ViewEvent) {
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
    this.ascii.dispose();
  }
}
