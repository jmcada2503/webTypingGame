import * as THREE from 'three';
import { ASCII_STYLE, fitToViewport } from '../render/asciiStyle';
import { GpuAsciiRenderer } from '../render/GpuAsciiRenderer';
import { matchPrefix } from '../utils/matchPrefix';
import type { GameView } from './GameView';
import type { GameViewState, ViewEvent } from './GameViewState';

const MAX_LIVES = 3;
const EVENT_LABEL_SECONDS = 1.2;

/**
 * Skeleton GameView. Placeholders until the visual tickets replace them:
 * - rotating cube where the Enemy ship goes ("Enemy ship and space backdrop")
 * - Word bullets as plain text sliding down by Flight ("Words in the ASCII world", "Word bullets in flight")
 * - Cockpit readouts as one text row ("Cockpit design")
 * - ViewEvents shown as a label top center (juice tickets)
 */
export class AsciiGameView implements GameView {
  readonly canvas: HTMLCanvasElement;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);
  private readonly placeholder: THREE.Mesh;
  private lastEvent: { label: string; age: number } | null = null;

  static async create(): Promise<AsciiGameView> {
    return new AsciiGameView(await GpuAsciiRenderer.create());
  }

  private constructor(private readonly ascii: GpuAsciiRenderer) {
    this.canvas = ascii.canvas;
    const { directional, ambient, flatShadingDefault } = ASCII_STYLE.lighting;
    const sun = new THREE.DirectionalLight(0xffffff, directional.intensity);
    sun.position.set(...directional.position);
    this.scene.add(sun, new THREE.AmbientLight(0xffffff, ambient));

    this.camera.position.set(0, 0, 7);
    this.placeholder = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 1.2, 1.2),
      new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: flatShadingDefault }),
    );
    this.placeholder.position.set(0, 1.4, 0);
    this.scene.add(this.placeholder);
  }

  render(state: GameViewState, dt: number) {
    this.placeholder.rotation.y += dt * 0.53;
    this.placeholder.rotation.x += dt * 0.24;
    if (this.lastEvent && (this.lastEvent.age += dt) > EVENT_LABEL_SECONDS) this.lastEvent = null;

    const text = this.ascii.textGrid;
    text.clear();
    this.drawWordBullets(state);
    this.drawCockpit(state);
    if (this.lastEvent) text.write(Math.floor((text.cols - this.lastEvent.label.length) / 2), 1, this.lastEvent.label, 'dim');

    this.ascii.render(this.scene, this.camera);
  }

  private drawWordBullets(state: GameViewState) {
    const text = this.ascii.textGrid;
    const top = 4;
    const bottom = text.rows - 8;
    state.wordBullets.forEach((b, i) => {
      const row = Math.round(top + (bottom - top) * Math.min(Math.max(b.flight, 0), 1));
      const len = [...b.word].length;
      // Spread bullets sideways so overlapping flights stay readable.
      const lane = ((i % 5) - 2) * 20;
      const col = Math.floor(text.cols / 2 + lane - len / 2);
      const matched = matchPrefix(state.typedWord, b.word);
      const letters = [...b.word];
      text.write(col, row, letters.slice(0, matched).join(''), 'green');
      text.write(col + matched, row, letters.slice(matched).join(''), 'fg');
    });
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
    this.ascii.dispose();
  }
}
