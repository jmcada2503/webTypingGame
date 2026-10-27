// Visual sandbox: the real render layer driven by a tweak panel instead of game mechanics.
import GUI from 'lil-gui';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import '../app/app.css';
import { AppShell } from '../app/AppShell';
import { KeyboardTypingInput } from '../input/KeyboardTypingInput';
import { AsciiGameView } from '../view/AsciiGameView';
import { WORD_FLIGHT } from '../view/words/flightPath';
import { ENEMY_LOOK } from '../view/enemy/EnemyShip';
import { STAR_DRIFT } from '../view/enemy/StarDrift';
import { RADAR_PROTO } from '../view/cockpitPrototype/radars';
import { WORD_LOOK } from '../view/words/WordBulletSprites';
import { SAMPLE_WORDS, SandboxSession } from './SandboxSession';

const session = new SandboxSession();
const input = new KeyboardTypingInput();
const view = await AsciiGameView.create();
const shell = new AppShell(view, session, input);
shell.start();
if (import.meta.env.DEV) Object.assign(window, { sandbox: session });

// ---- tweak panel ----
const gui = new GUI({ title: 'Sandbox' });
const live = { typed: '', bullets: 0, shots: 0, status: '' };

const snap = gui.addFolder('Snapshot');
snap.add(session, 'lives', 0, 3, 1).name('Lives');
snap.add(session, 'attackWord').name('Attack word').listen();
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

const look = gui.addFolder('Word bullet look + path');
look.add(WORD_LOOK, 'height', 0.05, 1, 0.01).name('word size');
look.add(WORD_LOOK, 'padX', 0, 4, 0.25).name('padding ↔ (letters)');
look.add(WORD_LOOK, 'padY', 0, 1, 0.05).name('padding ↕ (em)');
look.add(WORD_FLIGHT.end, 'y', -3, 3, 0.05).name('end y');
look.add(WORD_FLIGHT.end, 'z', -5, 6, 0.1).name('end z');
look.add(WORD_FLIGHT, 'laneSpread', 0, 3, 0.05).name('lane spread');

const en = gui.addFolder('Enemy ship + stars');
en.add(ENEMY_LOOK, 'scale', 0.3, 3, 0.05);
en.add(ENEMY_LOOK.position, 'y', -2, 14, 0.1).name('position y');
en.add(ENEMY_LOOK.position, 'z', -70, -5, 0.5).name('position z');
en.add(ENEMY_LOOK, 'bob', 0, 2, 0.05);
en.add(ENEMY_LOOK, 'sway', 0, 3, 0.05);
en.add(ENEMY_LOOK, 'bank', 0, 1, 0.01);
en.add(STAR_DRIFT, 'speed', 0, 40, 0.5).name('star speed');

const ev = gui.addFolder('Events');
ev.add(session, 'submitDestroys').name('typing destroys match');
ev.add({ destroy: () => session.destroyOldest() }, 'destroy').name('destroy oldest');
ev.add({ destroyNew: () => session.destroyNewest() }, 'destroyNew').name('destroy newest');
ev.add({ arrive: () => session.arriveOldest() }, 'arrive').name('arrive oldest');
ev.add({ lifeLost: () => session.emit({ type: 'lifeLost' }) }, 'lifeLost').name('lifeLost');

const sh = gui.addFolder('Shots (Radar)');
sh.add({ fire: () => session.fireAttack() }, 'fire').name('fire Attack word');
sh.add({ defend: () => session.defendOldestShot() }, 'defend').name('enemy defends oldest');
sh.add(session, 'shotFlightSeconds', 1, 20, 0.5).name('shot flight time (s)');
sh.add(session, 'newAttackWordOnFire').name('new Attack word on fire');
sh.add(live, 'shots').name('in flight').disable().listen();
sh.add(RADAR_PROTO, 'kind', ['C', 'A']).name('radar design (prototype)').listen();

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
  live.shots = session.shotCount;
  stats.update();
  requestAnimationFrame(poll);
})();
