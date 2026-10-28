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
import { WORD_LOOK } from '../view/words/WordBulletSprites';
import { DESTROY_LOOK } from '../view/juice/WordDestroyFx';
import { HIT_LOOK } from '../view/juice/HitFx';
import { SHOT_HIT_LOOK } from '../view/juice/ShotHitFx';
import { DAMAGE_LOOK } from '../view/juice/EnemyDamageFx';
import { ATTACK_SPARKS_LOOK } from '../view/juice/AttackSparks';
import { PACE_LOOK } from '../view/juice/PaceMotion';
import { SCREEN_FILTERS } from '../render/ScreenFilters';
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
snap.add(session, 'lives', 0, 3, 1).name('Lives').listen();
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
look.add(WORD_LOOK, 'border', 0, 0.4, 0.01).name('outline (em)');
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

const dx = gui.addFolder('Destroy effect');
dx.add(DESTROY_LOOK, 'shardSpeed', 2, 30, 0.5).name('shard speed');
dx.add(DESTROY_LOOK, 'shardSpin', 0, 30, 0.5).name('shard spin');
dx.add(DESTROY_LOOK, 'burstSeconds', 0.15, 1.5, 0.05).name('ring time (s)');
dx.add(DESTROY_LOOK, 'burstSize', 0.5, 6, 0.1).name('ring size');

const hx = gui.addFolder('Hit effect');
hx.add(HIT_LOOK, 'boomSeconds', 0.15, 2, 0.05).name('debris time (s)');
hx.add(HIT_LOOK, 'boomSize', 0.2, 4, 0.05).name('debris spread');
hx.add(HIT_LOOK, 'shakeSeconds', 0.05, 1.5, 0.05).name('shake time (s)');
hx.add(HIT_LOOK, 'shake', 0, 0.6, 0.005).name('shake strength');
hx.add(HIT_LOOK, 'roll', 0, 0.4, 0.005).name('roll');
hx.add(HIT_LOOK, 'flashSeconds', 0, 2, 0.05).name('black flash time (s)');

const shx = gui.addFolder('Shot hit effect');
shx.add(SHOT_HIT_LOOK, 'seconds', 0.3, 3, 0.05).name('time (s)');
shx.add(SHOT_HIT_LOOK, 'dip', 0, 4, 0.05).name('ship sag');
shx.add(SHOT_HIT_LOOK, 'boomSize', 0.5, 8, 0.1).name('explosion size');

const dmg = gui.addFolder('Enemy damage effect');
dmg.add(DAMAGE_LOOK, 'smoke', 0, 6, 0.1).name('smoke amount');
dmg.add(DAMAGE_LOOK, 'wingTipAt', 0, 1, 0.05).name('wing tip lost at');
dmg.add(DAMAGE_LOOK, 'engineAt', 0, 1, 0.05).name('engine lost at');

const ask = gui.addFolder('Attack sparks');
ask.add(ATTACK_SPARKS_LOOK, 'count', 1, 40, 1);
ask.add(ATTACK_SPARKS_LOOK, 'seconds', 0.1, 3, 0.05).name('sparks time (s)');
ask.add(ATTACK_SPARKS_LOOK, 'reach', 0.05, 1, 0.01);
ask.add(ATTACK_SPARKS_LOOK, 'thickness', 0.001, 0.02, 0.0005);
ask.add(ATTACK_SPARKS_LOOK, 'length', 0.01, 0.2, 0.005);
ask.add(ATTACK_SPARKS_LOOK, 'gravity', 0, 20, 0.5);

const pc = gui.addFolder('Pace');
pc.add(session, 'measuredPace').name('your Pace, chars/s').disable().listen();
pc.add(session, 'playerPaceOverride', -1, 10, 0.1).name('your Pace override (-1 = off)');
pc.add(session, 'enemyPace', 0, 10, 0.1).name('enemy Pace, chars/s');
pc.add(STAR_DRIFT, 'motion').name('moving stars (player setting)');
pc.add(STAR_DRIFT, 'speed').name('star speed (now)').disable().listen();
pc.add(PACE_LOOK, 'fast', 1, 10, 0.1).name('fast Pace');
pc.add(PACE_LOOK, 'limit', 2, 15, 0.1).name('limit Pace');
pc.add(PACE_LOOK, 'starsAtFast', 2, 80, 1).name('star speed at fast');
pc.add(PACE_LOOK, 'starsAtLimit', 2, 120, 1).name('star speed at limit');
pc.add(PACE_LOOK, 'maxGap', 0.2, 6, 0.1).name('lead for min / max size');
pc.add(PACE_LOOK, 'minSize', 0.1, 1.5, 0.05).name('ship size, you way ahead');
pc.add(PACE_LOOK, 'equalSize', 0.5, 2, 0.05).name('ship size, equal Pace');
pc.add(PACE_LOOK, 'maxSize', 1, 4, 0.05).name('ship size, enemy way ahead');

const sf = gui.addFolder('Screen filters');
sf.add(SCREEN_FILTERS, 'scanlines').listen();
sf.add(SCREEN_FILTERS, 'scanStrength', 0, 1, 0.01).name('scanline strength').listen();
sf.add(SCREEN_FILTERS, 'scanPeriod', 2, 12, 1).name('scanline spacing (px)').listen();
sf.add(SCREEN_FILTERS, 'glow').listen();
sf.add(SCREEN_FILTERS, 'glowStrength', 0, 3, 0.05).name('glow strength').listen();
sf.add(SCREEN_FILTERS, 'glowRadius', 0.5, 6, 0.1).name('glow radius').listen();
sf.add(SCREEN_FILTERS, 'glowThreshold', 0, 1, 0.01).name('glow threshold').listen();
sf.add(SCREEN_FILTERS, 'vignette', 0, 1, 0.01).name('dark edges').listen();
sf.add(SCREEN_FILTERS, 'curvature', 0, 1, 0.01).name('screen curve').listen();
sf.add(SCREEN_FILTERS, 'cornerRadius', 0, 0.3, 0.005).name('corner roundness').listen();
sf.add(SCREEN_FILTERS, 'aberration', 0, 10, 0.1).name('color fringes (px)').listen();
sf.add(SCREEN_FILTERS, 'glass', 0, 0.2, 0.005).name('tube glass').listen();
sf.add(SCREEN_FILTERS, 'noise', 0, 0.3, 0.005).name('grain').listen();
sf.add(SCREEN_FILTERS, 'flicker', 0, 0.2, 0.005).listen();

const ev = gui.addFolder('Events');
ev.add(session, 'submitDestroys').name('typing destroys match');
ev.add({ destroy: () => session.destroyOldest() }, 'destroy').name('destroy oldest');
ev.add({ destroyNew: () => session.destroyNewest() }, 'destroyNew').name('destroy newest');
ev.add({ arrive: () => session.arriveOldest() }, 'arrive').name('arrive oldest');
ev.add(session, 'arrivalCostsLife').name('arrival costs a life');
ev.add({ refill: () => session.refillLives() }, 'refill').name('refill Lives');
ev.add({ lifeLost: () => session.emit({ type: 'lifeLost' }) }, 'lifeLost').name('lifeLost');

const sh = gui.addFolder('Shots (Radar)');
sh.add({ fire: () => session.fireAttack() }, 'fire').name('fire Attack word');
sh.add({ defend: () => session.defendOldestShot() }, 'defend').name('enemy defends oldest');
sh.add({ hit: () => session.hitOldestShot() }, 'hit').name('shot hits enemy now');
sh.add(session, 'enemyDamage', 0, 1, 0.01).name('enemy damage').listen();
sh.add(session, 'damagePerHit', 0, 0.5, 0.05).name('damage per hit');
sh.add({ repair: () => (session.enemyDamage = 0) }, 'repair').name('repair enemy');
sh.add(session, 'shotFlightSeconds', 1, 20, 0.5).name('shot flight time (s)');
sh.add(session, 'newAttackWordOnFire').name('new Attack word on fire');
sh.add(live, 'shots').name('in flight').disable().listen();

const time = gui.addFolder('Time');
time.add(session, 'paused').name('pause');
time.add({ step: () => session.step() }, 'step').name('step 1 frame');

gui.add({ fs: () => void shell.toggleFullscreen() }, 'fs').name('⛶ fullscreen');

// Every folder starts collapsed; open only what you need.
gui.foldersRecursive().forEach((f) => f.close());

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
