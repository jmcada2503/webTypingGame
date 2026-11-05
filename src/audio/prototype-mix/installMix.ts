// PROTOTYPE (mix and balance, throwaway, dev only, branch prototype/mix-and-balance, #169).
// A live tuning panel (lil-gui, top right) for the real game: levels, per-group trims, ducking the music under big moments,
// stacking when many Word bullets die together, keystroke fatigue over long runs, and sounds for the settings panel itself.
// Play real Matches (`?fake` + Ctrl+F) and Practice, tune by ear, then press "Copy numbers". Values persist in localStorage while tuning.
import GUI from 'lil-gui';
import type { AudioEngine } from '../AudioEngine';
import type { SoundPanel } from '../../screens/soundPanel';
import { SOUNDS } from '../sounds';
import { busGains, type SoundSettings } from '../soundSettings';

const KEY = 'mix-proto';

/** Which tuning group a sound belongs to. */
const GROUPS = {
  keys: ['keyClimb'],
  badKeys: ['keyNoMatch', 'wrongSubmit'],
  backspace: ['keyBackspace'],
  bulletDestroyed: ['wordBulletDestroyed'],
  threat: ['enemyFired', 'closeWarning'],
  lives: ['lifeLost', 'lastLife'],
  attack: ['attackFired', 'shotHit', 'shotDefended'],
  idleAndPeace: ['idleNudge', 'peaceTick'],
  screens: ['menuMove', 'menuConfirm', 'menuBack', 'sponsor', 'copyLink', 'language', 'glitch', 'tvOn', 'tvOff', 'opponentFound', 'countdownTick', 'go', 'resumeTick', 'enemyBack', 'signalLost', 'errorSting', 'settingsBlip', 'settingsKeyBlip'],
  endScreens: ['scoreTick', 'newBest', 'rematchProposed', 'rematchAccepted', 'rematchDeclined', 'opponentLeftWin'],
  endings: ['winEnding', 'loseEnding', 'peaceEnding'],
} as const;
type Group = keyof typeof GROUPS;
const groupOf = (id: string): Group | null => (Object.keys(GROUPS) as Group[]).find((g) => GROUPS[g].some((p) => id === p || (p === 'keyClimb' && id.startsWith('keyClimb')))) ?? null;

/** Sounds the music ducks under (checkboxes). */
const DUCK_TRIGGERS: Record<string, string[]> = {
  lifeLost: ['lifeLost'],
  lastLife: ['lastLife'],
  attackFired: ['attackFired', 'shotHit'],
  bulletDestroyed: ['wordBulletDestroyed'],
  tvTransition: ['tvOff', 'tvOn', 'glitch'],
  endings: ['winEnding', 'loseEnding', 'peaceEnding'],
};

const DEFAULTS = {
  // levels on top of the player's settings (dB)
  effectsDb: 0,
  musicDb: 0,
  // group trims (dB)
  trim: { keys: 0, badKeys: 0, backspace: 0, bulletDestroyed: 0, threat: 0, lives: 0, attack: 0, idleAndPeace: 0, screens: 0, endScreens: 0, endings: 0 } as Record<Group, number>,
  duck: { depthDb: 0, attackMs: 40, holdMs: 250, releaseMs: 600, on: { lifeLost: true, lastLife: true, attackFired: false, bulletDestroyed: false, tvTransition: false, endings: true } as Record<string, boolean> },
  stack: { destroyedVoices: 6, destroyedStackDb: 0 }, // each simultaneous (within 120 ms) Word-bullet destroy is this much quieter than the last
  fatigue: { dbDown: 0, rampSeconds: 60, keyGapSeconds: 1.5 }, // typing continuously for rampSeconds lowers the keys by dbDown
  panelSounds: false, // move / open / close sounds in the sound settings panel
};
type Mix = typeof DEFAULTS;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const db = (x: number) => 10 ** (x / 20);

export function installMixPrototype(sound: AudioEngine<AudioContext, string>, panel: SoundPanel, settings: () => SoundSettings) {
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Mix> | null;
    } catch {
      return null;
    }
  })();
  const mix: Mix = { ...clone(DEFAULTS), ...(saved ?? {}) };
  const persist = () => localStorage.setItem(KEY, JSON.stringify(mix));

  // --- Buses: tuned level on top of the settings; ducking multiplies the music bus ---
  const buses = (sound as unknown as { buses: { effects: { gain: AudioParam }; music: { gain: AudioParam } } | null }).buses;
  const ctx = sound.context as AudioContext | null;
  const musicBase = () => busGains(settings()).music * db(mix.musicDb);
  const effectsBase = () => busGains(settings()).effects * db(mix.effectsDb);
  const applyLevels = () => {
    if (!buses || !ctx) return;
    buses.effects.gain.setValueAtTime(effectsBase(), ctx.currentTime);
    buses.music.gain.cancelScheduledValues(ctx.currentTime);
    buses.music.gain.setValueAtTime(musicBase(), ctx.currentTime);
  };
  const origApply = sound.applySettings.bind(sound);
  sound.applySettings = (s) => {
    origApply(s);
    applyLevels();
  };

  const doDuck = () => {
    if (!buses || !ctx || mix.duck.depthDb === 0) return;
    const now = ctx.currentTime;
    const g = buses.music.gain;
    const low = musicBase() * db(-Math.abs(mix.duck.depthDb));
    g.cancelScheduledValues(now);
    g.setTargetAtTime(low, now, Math.max(0.005, mix.duck.attackMs / 3000));
    const back = now + (mix.duck.attackMs + mix.duck.holdMs) / 1000;
    g.setTargetAtTime(musicBase(), back, Math.max(0.01, mix.duck.releaseMs / 3000));
  };

  // --- Per-play gain: group trim, stacking, fatigue ---
  const recent = new Map<string, number[]>();
  let typingSince = 0;
  let lastKey = 0;
  const gainFor = (id: string): number => {
    let g = 1;
    const group = groupOf(id);
    if (group) g *= db(mix.trim[group]);
    const now = performance.now();
    if (id === 'wordBulletDestroyed' && mix.stack.destroyedStackDb !== 0) {
      const list = (recent.get(id) ?? []).filter((t) => now - t < 120);
      g *= db(-mix.stack.destroyedStackDb * list.length);
      list.push(now);
      recent.set(id, list);
    }
    if ((group === 'keys' || group === 'backspace') && mix.fatigue.dbDown !== 0) {
      if (now - lastKey > mix.fatigue.keyGapSeconds * 1000) typingSince = now;
      lastKey = now;
      const t = Math.min(1, (now - typingSince) / (mix.fatigue.rampSeconds * 1000));
      g *= db(-mix.fatigue.dbDown * t);
    }
    return g;
  };
  const origPlay = sound.play.bind(sound);
  sound.play = (id: string) => {
    origPlay(id as never, gainFor(id));
    if (Object.entries(DUCK_TRIGGERS).some(([k, ids]) => mix.duck.on[k] && ids.includes(id))) doDuck();
  };

  // --- Voice cap for simultaneous Word bullet destroys ---
  const applyVoices = () => void (SOUNDS.wordBulletDestroyed.voices = mix.stack.destroyedVoices);

  // --- Sounds for the settings panel itself ---
  const onKey = panel.onKey.bind(panel);
  panel.onKey = (e) => {
    const before = { open: panel.isOpen, row: panel.row };
    const taken = onKey(e);
    if (mix.panelSounds && taken) {
      if (!before.open && panel.isOpen) sound.play('menuConfirm');
      else if (before.open && !panel.isOpen) sound.play('menuBack');
      else if (before.open && before.row !== panel.row) sound.play('menuMove');
    }
    return taken;
  };

  // --- The panel ---
  const gui = new GUI({ title: 'MIX (prototype)', width: 300 });
  gui.domElement.style.zIndex = '99999';
  const change = () => {
    persist();
    applyLevels();
    applyVoices();
  };
  const L = gui.addFolder('Levels (dB on top of the settings)');
  L.add(mix, 'effectsDb', -24, 12, 0.5).name('effects bus').onChange(change);
  L.add(mix, 'musicDb', -24, 12, 0.5).name('music bus').onChange(change);
  const T = gui.addFolder('Trims per group (dB)');
  (Object.keys(mix.trim) as Group[]).forEach((g) => T.add(mix.trim, g, -24, 12, 0.5).onChange(change));
  const D = gui.addFolder('Music ducking');
  D.add(mix.duck, 'depthDb', 0, 24, 0.5).name('depth (0 = off)').onChange(change);
  D.add(mix.duck, 'attackMs', 5, 300, 5).onChange(change);
  D.add(mix.duck, 'holdMs', 0, 2000, 25).onChange(change);
  D.add(mix.duck, 'releaseMs', 50, 3000, 25).onChange(change);
  Object.keys(mix.duck.on).forEach((k) => D.add(mix.duck.on, k).name(`duck on ${k}`).onChange(change));
  const S = gui.addFolder('Many sounds at once');
  S.add(mix.stack, 'destroyedVoices', 1, 8, 1).name('destroy voices max').onChange(change);
  S.add(mix.stack, 'destroyedStackDb', 0, 9, 0.5).name('quieter per extra destroy').onChange(change);
  const F = gui.addFolder('Keystroke fatigue');
  F.add(mix.fatigue, 'dbDown', 0, 18, 0.5).name('keys down by (dB)').onChange(change);
  F.add(mix.fatigue, 'rampSeconds', 5, 180, 5).name('over (s of typing)').onChange(change);
  F.add(mix.fatigue, 'keyGapSeconds', 0.5, 5, 0.5).name('pause that resets (s)').onChange(change);
  gui.add(mix, 'panelSounds').name('sounds in the settings panel').onChange(change);
  const copy = gui.add({ copy: () => {
    const text = JSON.stringify(mix, null, 2);
    console.info('[mix] numbers to apply:\n' + text);
    void navigator.clipboard?.writeText(text).catch(() => {});
    copy.name('Copied! (also in the console)');
    setTimeout(() => copy.name('Copy numbers'), 1800);
  } }, 'copy').name('Copy numbers');
  gui.add({ reset: () => {
    Object.assign(mix, clone(DEFAULTS));
    localStorage.removeItem(KEY);
    location.reload();
  } }, 'reset').name('Reset to defaults (reloads)');
  change();
}
