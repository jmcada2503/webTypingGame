// Visual sandbox: the real render layer driven by a tweak panel instead of game mechanics.
import GUI from 'lil-gui';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import '../app/app.css';
import { AppShell } from '../app/AppShell';
import { KeyboardTypingInput } from '../input/KeyboardTypingInput';
import { AsciiGameView } from '../view/AsciiGameView';
import { SAMPLE_WORDS, SandboxSession } from './SandboxSession';

const session = new SandboxSession();
const input = new KeyboardTypingInput();
const view = await AsciiGameView.create();
const shell = new AppShell(view, session, input);
shell.start();

// ---- tweak panel ----
const gui = new GUI({ title: 'Sandbox' });
const live = { typed: '', bullets: 0, status: '' };

const snap = gui.addFolder('Snapshot');
snap.add(session, 'lives', 0, 3, 1).name('Lives');
snap.add(session, 'attackWord').name('Attack word');
snap.add(live, 'typed').name('Typed word').disable().listen();
snap.add(session, 'lastSubmitted').name('last submitted').disable().listen();

const spawnOpts = { word: SAMPLE_WORDS[0] };
const wb = gui.addFolder('Word bullets');
wb.add(spawnOpts, 'word', SAMPLE_WORDS).name('word');
wb.add({ spawn: () => session.spawn(spawnOpts.word) }, 'spawn').name('spawn word');
wb.add({ random: () => session.spawn() }, 'random').name('spawn random');
wb.add(session, 'autoSpawn').name('auto spawn');
wb.add(session, 'spawnEvery', 0.2, 5, 0.1).name('spawn every (s)');
wb.add(session, 'flightSeconds', 1, 20, 0.5).name('flight time (s)');
wb.add(live, 'bullets').name('in flight').disable().listen();
wb.add({ clear: () => session.clearBullets() }, 'clear').name('clear all');

const ev = gui.addFolder('Events');
ev.add({ destroy: () => session.destroyOldest() }, 'destroy').name('destroy oldest');
ev.add({ arrive: () => session.arriveOldest() }, 'arrive').name('arrive oldest');
ev.add({ lifeLost: () => session.emit({ type: 'lifeLost' }) }, 'lifeLost').name('lifeLost');
ev.add({ attack: () => session.emit({ type: 'attackFired', word: session.attackWord }) }, 'attack').name('attackFired');

const time = gui.addFolder('Time');
time.add(session, 'paused').name('pause');
time.add({ step: () => session.step() }, 'step').name('step 1 frame');

gui.add({ fs: () => void shell.toggleFullscreen() }, 'fs').name('⛶ fullscreen');

const stats = new Stats();
stats.dom.style.left = '72px'; // next to the fullscreen button
document.body.append(stats.dom);
(function poll() {
  live.typed = input.typedWord;
  live.bullets = session.bulletCount;
  stats.update();
  requestAnimationFrame(poll);
})();

// Clicking the canvas takes focus away from panel text fields so typing reaches the game.
view.canvas.addEventListener('pointerdown', () => (document.activeElement as HTMLElement | null)?.blur());
