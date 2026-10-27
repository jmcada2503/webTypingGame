import * as THREE from 'three';
import { ASCII_STYLE, fitToViewport } from '../render/asciiStyle';
import { GpuAsciiRenderer } from '../render/GpuAsciiRenderer';
import { mountPrototypeSwitcher } from '../prototypes/PrototypeSwitcher';
import type { GameView } from './GameView';
import type { GameViewState, ViewEvent } from './GameViewState';
import { createWordLayer, WORD_VARIANTS, type WordLayer } from './wordsPrototype/variants';

const MAX_LIVES = 3;
const EVENT_LABEL_SECONDS = 1.2;

/**
 * Skeleton GameView. Placeholders until the visual tickets replace them:
 * - rotating cube where the Enemy ship goes ("Enemy ship and space backdrop")
 * - Word bullets: PROTOTYPE variants via ?variant= ("Words in the ASCII world")
 * - Cockpit readouts as one text row ("Cockpit design")
 * - ViewEvents shown as a label top center (juice tickets)
 */
export class AsciiGameView implements GameView {
  readonly canvas: HTMLCanvasElement;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);
  private readonly placeholder: THREE.Mesh;
  private lastEvent: { label: string; age: number } | null = null;
  private words!: WordLayer;

  static async create(): Promise<AsciiGameView> {
    const view = new AsciiGameView(await GpuAsciiRenderer.create());
    view.words = await createWordLayer(mountPrototypeSwitcher(WORD_VARIANTS), view.scene);
    return view;
  }

  private constructor(private readonly ascii: GpuAsciiRenderer) {
    this.canvas = ascii.canvas;
    const { directional, ambient, flatShadingDefault } = ASCII_STYLE.lighting;
    const sun = new THREE.DirectionalLight(0xffffff, directional.intensity);
    sun.position.set(...directional.position);
    this.scene.add(sun, new THREE.AmbientLight(0xffffff, ambient));

    this.camera.position.set(0, 0, 7);
    this.placeholder = new THREE.Mesh(
      new THREE.BoxGeometry(3, 3, 3),
      new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: flatShadingDefault }),
    );
    // Far away so Word bullets have room to fly toward the camera.
    this.placeholder.position.set(0, 7.5, -27);
    this.scene.add(this.placeholder);
  }

  render(state: GameViewState, dt: number) {
    this.placeholder.rotation.y += dt * 0.53;
    this.placeholder.rotation.x += dt * 0.24;
    if (this.lastEvent && (this.lastEvent.age += dt) > EVENT_LABEL_SECONDS) this.lastEvent = null;

    const text = this.ascii.textGrid;
    text.clear();
    this.words.draw({ state, camera: this.camera, text });
    this.drawCockpit(state);
    if (this.lastEvent) text.write(Math.floor((text.cols - this.lastEvent.label.length) / 2), 4, this.lastEvent.label, 'dim');

    this.ascii.render(this.scene, this.camera, this.words.overlay && { scene: this.words.overlay, camera: this.camera });
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
    this.placeholder.geometry.dispose();
    (this.placeholder.material as THREE.Material).dispose();
    this.words.dispose();
    this.ascii.dispose();
  }
}
