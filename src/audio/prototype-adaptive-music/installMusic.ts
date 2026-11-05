// PROTOTYPE (adaptive music, throwaway, dev only). One chiptune piece composed in code with Tone.js, in the Arcade
// style, playing live in the game. Four variants of WHAT DRIVES THE INTENSITY, switchable with `?music=A|B|C|D`
// (bottom bar, or Shift+Alt+← / →). The panel on the right shows the inputs, the intensity and the layers.
//
// Music: 120 BPM (2 beats per Countdown second), bars of 2 s, a 4-bar loop. Layers: pad, bass, kick, snare, hats,
// arp, lead, plus a low-pass that opens with intensity. Screen states: menu loop, Countdown riser (timed so the
// Match starts on a downbeat), the TV gap ducked, the Match adaptive, ending stingers, end-screen loop.
import * as Tone from 'tone';
import type { ScreenFlow } from '../../flow/ScreenFlow';
import type { ScreenHost } from '../../screens/ScreenHost';
import type { GameViewState, ViewEvent } from '../../view/GameViewState';

type Layer = 'pad' | 'bass' | 'kick' | 'snare' | 'hats' | 'arp' | 'lead';
const LAYERS: Layer[] = ['pad', 'bass', 'kick', 'snare', 'hats', 'arp', 'lead'];
/** Intensity at which each layer joins the Match (it leaves 0.06 lower, after holding 2 bars). */
const THRESHOLD: Record<Layer, number> = { pad: 0, bass: 0.18, kick: 0.32, snare: 0.45, hats: 0.52, arp: 0.6, lead: 0.75 };
const LEVEL: Record<Layer, number> = { pad: 0.5, bass: 0.55, kick: 0.8, snare: 0.45, hats: 0.25, arp: 0.3, lead: 0.32 };

type MusicState = 'menu' | 'countdown' | 'starting' | 'match' | 'held' | 'endingWin' | 'endingLose' | 'endingPeace' | 'end';
/** -1 losing (darker harmony), 0 neutral, 1 winning (major). Only the Duel and Blend drivers set it. */
type Mood = -1 | 0 | 1;

interface Inputs {
  mode: 'versus' | 'practice';
  lives: number;
  bullets: number;
  maxFlight: number;
  pacePlayer: number;
  paceEnemy: number;
  enemyDamage: number;
  matchTime: number;
}

interface Driver {
  key: string;
  name: string;
  idea: string;
  raw: (i: Inputs) => { intensity: number; mood?: Mood };
}

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const danger = (i: Inputs) => clamp(0.12 + 0.55 * i.maxFlight ** 1.6 + 0.08 * Math.min(i.bullets, 4) + 0.12 * (3 - i.lives));
const duel = (i: Inputs): { intensity: number; mood: Mood } => {
  if (i.mode === 'practice') return { intensity: clamp(0.15 + 0.8 * (i.pacePlayer / 8)), mood: 0 }; // no opponent: your own Pace
  const gap = i.pacePlayer - i.paceEnemy;
  const energy = clamp((i.pacePlayer + i.paceEnemy) / 12);
  return { intensity: clamp(0.15 + 0.5 * energy + 0.35 * clamp(Math.abs(gap) / 4)), mood: gap > 0.8 ? 1 : gap < -0.8 ? -1 : 0 };
};
const arc = (i: Inputs) => clamp(0.15 + 0.6 * clamp(i.matchTime / (i.mode === 'practice' ? 300 : 120)) + 0.1 * (3 - i.lives) + 0.1 * i.enemyDamage);

const DRIVERS: Driver[] = [
  { key: 'A', name: 'Danger', idea: 'Threat: how close the nearest Word bullet is, how many are flying, Lives lost. Music surges when you are about to be hit.', raw: (i) => ({ intensity: danger(i) }) },
  { key: 'B', name: 'Duel', idea: 'Pace: both players typing fast = intense; a big Pace gap = more. Winning on Pace = major harmony, losing = darker. Practice: your own Pace.', raw: duel },
  { key: 'C', name: 'Arc', idea: 'Story: builds over Match time (2 min online, 5 min Practice), plus Lives lost and Enemy damage. Slow, steady climb.', raw: (i) => ({ intensity: arc(i) }) },
  { key: 'D', name: 'Blend', idea: '50% Danger + 30% Duel + 20% Arc, with the Duel mood. Danger spikes still cut through.', raw: (i) => { const d = duel(i); return { intensity: clamp(Math.max(danger(i) * 0.85, 0.5 * danger(i) + 0.3 * d.intensity + 0.2 * arc(i))), mood: d.mood }; } },
];

// Harmony: 4 bars per mood. Chords as [bass root, ...pad notes].
const PROGRESSIONS: Record<Mood, string[][]> = {
  0: [['A1', 'A3', 'C4', 'E4'], ['F1', 'F3', 'A3', 'C4'], ['C2', 'C4', 'E4', 'G4'], ['G1', 'G3', 'B3', 'D4']], // Am F C G
  1: [['C2', 'C4', 'E4', 'G4'], ['G1', 'G3', 'B3', 'D4'], ['A1', 'A3', 'C4', 'E4'], ['F1', 'F3', 'A3', 'C4']], // C G Am F
  [-1]: [['A1', 'A3', 'C4', 'E4'], ['A#1', 'A#3', 'D4', 'F4'], ['A1', 'A3', 'C4', 'E4'], ['E1', 'E3', 'G#3', 'B3']], // Am Bb Am E
};
const up = (n: string, oct: number) => n.replace(/\d$/, (d) => String(Number(d) + oct));
/** Lead: chord-tone indices per 8th note, a 4-bar phrase (-1 = rest). */
const LEAD_SHAPE = [
  [2, -1, 1, -1, 0, 1, 2, -1],
  [3, -1, 2, -1, 1, -1, 2, 1],
  [2, -1, 1, -1, 0, 1, 2, 3],
  [3, 2, 1, -1, 0, -1, -1, -1],
];

export async function installMusicPrototype(host: ScreenHost, flow: ScreenFlow, audio: { ctx: AudioContext; master: GainNode }) {
  Tone.setContext(audio.ctx);
  const transport = Tone.getTransport();
  transport.bpm.value = 120;

  const bus = new Tone.Gain(0.35);
  bus.connect(audio.master);
  const filter = new Tone.Filter(800, 'lowpass');
  filter.connect(bus);
  const layerGain = Object.fromEntries(LAYERS.map((l) => [l, new Tone.Gain(0).connect(filter)])) as Record<Layer, Tone.Gain>;

  const pad = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'triangle' }, envelope: { attack: 0.3, decay: 0.4, sustain: 0.6, release: 1.2 }, volume: -10 }).connect(layerGain.pad);
  const bass = new Tone.MonoSynth({ oscillator: { type: 'square' }, filter: { Q: 1, type: 'lowpass' }, filterEnvelope: { attack: 0.005, decay: 0.15, sustain: 0.3, baseFrequency: 200, octaves: 2.5 }, envelope: { attack: 0.005, decay: 0.1, sustain: 0.5, release: 0.1 }, volume: -8 }).connect(layerGain.bass);
  const kick = new Tone.MembraneSynth({ pitchDecay: 0.03, octaves: 6, envelope: { attack: 0.001, decay: 0.25, sustain: 0 }, volume: -4 }).connect(layerGain.kick);
  const snare = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.12, sustain: 0 }, volume: -10 }).connect(layerGain.snare);
  const hats = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.03, sustain: 0 }, volume: -16 }).connect(new Tone.Filter(7000, 'highpass').connect(layerGain.hats));
  const arp = new Tone.Synth({ oscillator: { type: 'square' }, envelope: { attack: 0.002, decay: 0.08, sustain: 0.2, release: 0.05 }, volume: -16 }).connect(layerGain.arp);
  const lead = new Tone.Synth({ oscillator: { type: 'square' }, envelope: { attack: 0.01, decay: 0.15, sustain: 0.4, release: 0.15 }, volume: -14 }).connect(layerGain.lead);
  const stinger = new Tone.Synth({ oscillator: { type: 'square' }, envelope: { attack: 0.002, decay: 0.1, sustain: 0.3, release: 0.3 }, volume: -10 }).connect(bus);
  const stingerPad = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'triangle' }, envelope: { attack: 0.05, decay: 0.5, sustain: 0.5, release: 2.5 }, volume: -10 }).connect(bus);
  const riserFilter = new Tone.Filter(300, 'bandpass').connect(bus);
  const riserGain = new Tone.Gain(0).connect(riserFilter);
  const riser = new Tone.Noise('white').connect(riserGain);

  // --- State shared between the game loop (frame) and the music clock (beats). ---
  const params = new URLSearchParams(location.search);
  let driverIndex = Math.max(0, DRIVERS.findIndex((d) => d.key === (params.get('music') ?? 'A').toUpperCase()));
  let state: MusicState = 'menu';
  let raw = 0;
  let smooth = 0;
  let mood: Mood = 0;
  let barMood: Mood = 0;
  let override: number | null = null;
  let inputs: Inputs = { mode: 'practice', lives: 3, bullets: 0, maxFlight: 0, pacePlayer: 0, paceEnemy: 0, enemyDamage: 0, matchTime: 0 };
  const on: Record<Layer, boolean> = Object.fromEntries(LAYERS.map((l) => [l, false])) as Record<Layer, boolean>;
  const lowSince: Record<Layer, number> = Object.fromEntries(LAYERS.map((l) => [l, 0])) as Record<Layer, number>;
  let started = false;

  /** Which layers each screen state plays, and the filter. `null` = the Match's adaptive rule. */
  const STATE_MIX: Record<MusicState, { layers: Partial<Record<Layer, number>>; cutoff: number } | null> = {
    menu: { layers: { pad: 0.45, arp: 0.18, bass: 0.25 }, cutoff: 1600 },
    countdown: { layers: { pad: 0.45, bass: 0.45, kick: 0.6 }, cutoff: 2500 },
    starting: { layers: { pad: 0.35 }, cutoff: 350 },
    match: null,
    held: { layers: { pad: 0.4, bass: 0.3 }, cutoff: 450 },
    endingWin: { layers: {}, cutoff: 6000 },
    endingLose: { layers: {}, cutoff: 300 },
    endingPeace: { layers: { pad: 0.45 }, cutoff: 900 },
    end: { layers: { pad: 0.4, arp: 0.12 }, cutoff: 1200 },
  };

  const level = () => (override ?? smooth);

  /** Every beat: decide the layers (on quickly, off only after holding 2 bars below), on the audio clock. */
  const applyMix = (time: number, barStart: boolean) => {
    const mix = STATE_MIX[state];
    if (mix) {
      for (const l of LAYERS) layerGain[l].gain.rampTo(mix.layers[l] ?? 0, state.startsWith('ending') ? 0.4 : 0.6, time);
      filter.frequency.rampTo(mix.cutoff, 0.8, time);
      return;
    }
    const v = level();
    for (const l of LAYERS) {
      if (v >= THRESHOLD[l]) (on[l] = true), (lowSince[l] = 0);
      else if (v < THRESHOLD[l] - 0.06 && on[l] && barStart && ++lowSince[l] >= 2) on[l] = false;
      layerGain[l].gain.rampTo(on[l] ? LEVEL[l] * (l === 'pad' && v > 0.7 ? 0.8 : 1) : 0, 0.3, time);
    }
    filter.frequency.rampTo(500 + 11500 * v ** 2, 0.5, time);
  };

  // --- The score: one 16th-note callback plays every layer (silent layers are just at gain 0). ---
  const SIXTEENTH = transport.PPQ / 4;
  transport.scheduleRepeat((time) => {
    const step = Math.round(transport.getTicksAtTime(time) / SIXTEENTH) % 64;
    const bar = Math.floor(step / 16);
    const s = step % 16;
    if (s === 0) barMood = mood; // harmony changes only on the bar
    const chord = PROGRESSIONS[barMood][bar];
    const v = state === 'match' ? level() : 0.3;
    if (s % 4 === 0) applyMix(time, s === 0);
    if (s === 0) pad.triggerAttackRelease(chord.slice(1), '1m', time, 0.6);
    if (s % 2 === 0) bass.triggerAttackRelease(s % 8 === 6 && v > 0.6 ? up(chord[0], 1) : chord[0], '16n', time, 0.8);
    if (s === 0 || s === 8 || (v > 0.8 && s === 10) || state === 'countdown' && s % 4 === 0) kick.triggerAttackRelease('C1', '8n', time);
    if (s === 4 || s === 12 || (v > 0.85 && bar === 3 && s >= 13)) snare.triggerAttackRelease('16n', time, s >= 13 ? 0.5 : 0.8);
    if (v > 0.8 ? true : s % 2 === 0) hats.triggerAttackRelease('32n', time, s % 4 === 2 ? 0.9 : 0.5);
    const tones = [...chord.slice(1), up(chord[1], 1)].map((n) => up(n, 1));
    arp.triggerAttackRelease(tones[(v > 0.85 ? s : Math.floor(s / 2)) % 4], '32n', time, 0.7);
    if (s % 2 === 0) {
      const idx = LEAD_SHAPE[bar][s / 2];
      if (idx >= 0) lead.triggerAttackRelease(up(tones[idx], 0), '8n', time, 0.7);
    }
  }, '16n');

  // --- Screen states from the flow; endings get stingers on the next beat. ---
  const setState = (next: MusicState) => {
    if (next === state) return;
    const prevState = state;
    state = next;
    const beat = transport.nextSubdivision('4n');
    if (next === 'countdown') {
      // Countdown (5 s) + TV gap (1.8 s) = 6.8 s: put the clock 1.2 s into a bar so the Match starts on a downbeat.
      transport.seconds = 1.2;
      riser.start();
      riserGain.gain.rampTo(0.12, 4.5);
      riserFilter.frequency.value = 300;
      riserFilter.frequency.rampTo(5000, 5);
    }
    if (next === 'starting' && prevState !== 'countdown') transport.seconds = 0.2; // Practice: 1.8 s gap to the downbeat
    if (prevState === 'countdown') {
      riserGain.gain.rampTo(0, 0.05);
      riser.stop('+0.2');
    }
    if (next === 'match') {
      smooth = raw = 0.15;
      for (const l of LAYERS) (on[l] = false), (lowSince[l] = 0);
    }
    if (next === 'endingWin') {
      ['C5', 'E5', 'G5', 'C6', 'E6', 'G6'].forEach((n, i) => stinger.triggerAttackRelease(n, '16n', beat + i * 0.07));
      stingerPad.triggerAttackRelease(['C4', 'E4', 'G4', 'C5'], 1.5, beat + 0.42);
    }
    if (next === 'endingPeace') stingerPad.triggerAttackRelease(['F3', 'A3', 'C4', 'E4'], 3, beat);
    applyMix(audio.ctx.currentTime, true);
  };

  const flowState = (): MusicState => {
    const s = flow.state();
    const shown = host.screenShown;
    if (s.screen === 'countdown') return 'countdown';
    if (s.screen === 'starting') return 'starting';
    if (s.screen === 'match') return s.link.status === 'ok' ? 'match' : 'held';
    if (s.screen === 'end' && shown === 'match') return s.mode === 'practice' || s.result === 'lost' ? 'endingLose' : s.result === 'won' ? 'endingWin' : 'endingPeace';
    if (s.screen === 'end') return 'end';
    return 'menu';
  };

  // --- Each frame: read the game, compute the raw intensity, smooth it (fast up, slow down). ---
  let matchTime = 0;
  const original = host.update.bind(host);
  host.update = (dt: number): ViewEvent[] => {
    const events = original(dt);
    if (!started && audio.ctx.state === 'running') {
      started = true;
      transport.start();
    }
    const next = flowState();
    if (next === 'match' && state !== 'match' && state !== 'held') matchTime = 0;
    setState(next);
    if (state === 'match') {
      matchTime += dt;
      const v: GameViewState = host.state();
      const s = flow.state();
      inputs = {
        mode: s.screen === 'match' ? s.mode : 'practice',
        lives: v.lives,
        bullets: v.wordBullets.length,
        maxFlight: Math.max(0, ...v.wordBullets.map((b) => b.flight)),
        pacePlayer: v.pace.player,
        paceEnemy: v.pace.enemy,
        enemyDamage: v.enemyDamage,
        matchTime,
      };
      const r = DRIVERS[driverIndex].raw(inputs);
      raw = r.intensity;
      mood = r.mood ?? 0;
      smooth += (raw - smooth) * (1 - Math.exp(-dt / (raw > smooth ? 0.6 : 3)));
    }
    ui.update();
    return events;
  };

  // --- UI: variant bar + live panel. ---
  const ui = mountUi({
    driver: () => DRIVERS[driverIndex],
    cycle: (dir) => {
      driverIndex = (driverIndex + dir + DRIVERS.length) % DRIVERS.length;
      const p = new URLSearchParams(location.search);
      p.set('music', DRIVERS[driverIndex].key);
      history.replaceState(null, '', `${location.pathname}?${p}${location.hash}`);
    },
    snapshot: () => ({ state, raw, smooth, level: level(), mood: barMood, inputs, on: { ...on }, gains: Object.fromEntries(LAYERS.map((l) => [l, layerGain[l].gain.value])) as Record<Layer, number>, cutoff: Number(filter.frequency.value), running: audio.ctx.state === 'running' }),
    setOverride: (v) => (override = v),
    setVolume: (v) => bus.gain.rampTo(v, 0.1),
  });
  addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      ui.cycle(e.key === 'ArrowLeft' ? -1 : 1);
    }
  }, true);
}

function mountUi(o: {
  driver: () => Driver;
  cycle: (dir: number) => void;
  snapshot: () => { state: MusicState; raw: number; smooth: number; level: number; mood: Mood; inputs: Inputs; on: Record<Layer, boolean>; gains: Record<Layer, number>; cutoff: number; running: boolean };
  setOverride: (v: number | null) => void;
  setVolume: (v: number) => void;
}) {
  const css = document.createElement('style');
  css.textContent = `
  .mp-bar{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:9999;display:flex;align-items:center;gap:10px;
    background:#fff;color:#111;font:600 13px system-ui,sans-serif;border-radius:999px;padding:6px 10px;box-shadow:0 4px 18px #0008}
  .mp-bar button{border:0;background:#111;color:#fff;border-radius:999px;width:28px;height:28px;cursor:pointer;font-size:14px}
  .mp-bar small{font-weight:400;color:#666}
  .mp-panel{position:fixed;right:10px;top:10px;z-index:9999;width:270px;background:#fffffff2;color:#111;font:12px system-ui,sans-serif;
    border-radius:10px;box-shadow:0 4px 18px #0008;padding:8px}
  .mp-panel.closed .mp-body{display:none}
  .mp-head{display:flex;justify-content:space-between;font-weight:700;cursor:pointer}
  .mp-idea{color:#444;margin:4px 0 6px}
  .mp-meter{height:14px;background:#eee;border-radius:4px;position:relative;margin:2px 0 6px;overflow:hidden}
  .mp-meter i{position:absolute;left:0;top:0;bottom:0;background:#e0a000}
  .mp-meter b{position:absolute;top:0;bottom:0;width:2px;background:#111}
  .mp-layers{display:grid;grid-template-columns:52px 1fr;gap:2px 6px;align-items:center;font:11px ui-monospace,monospace}
  .mp-layers .g{height:8px;background:#eee;border-radius:3px;overflow:hidden}.mp-layers .g i{display:block;height:100%;background:#1a9a3a}
  .mp-kv{font:11px ui-monospace,monospace;white-space:pre;background:#f2f2f2;border-radius:5px;padding:4px;margin-top:6px}
  .mp-row{display:flex;gap:6px;align-items:center;margin:4px 0}
  .mp-warn{color:#b00;font-weight:600}`;
  document.head.append(css);

  const bar = document.createElement('div');
  bar.className = 'mp-bar';
  bar.innerHTML = `<span style="color:#666;font-weight:400">MUSIC</span><button data-d="-1">◀</button><span class="mp-label"></span><button data-d="1">▶</button><small>Shift+Alt+← / →</small>`;
  bar.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => cycle(Number(b.dataset.d))));
  document.body.append(bar);

  const panel = document.createElement('div');
  panel.className = 'mp-panel';
  panel.innerHTML = `<div class="mp-head"><span>ADAPTIVE MUSIC PROTOTYPE</span><span>▾</span></div>
  <div class="mp-body">
    <div class="mp-warn" hidden>Press any key to turn audio on.</div>
    <div class="mp-idea"></div>
    <div>intensity <span class="mp-num"></span> <small style="color:#666">(bar = smoothed, line = raw)</small></div>
    <div class="mp-meter"><i></i><b></b></div>
    <div class="mp-layers">${LAYERS.map((l) => `<span>${l}</span><div class="g" data-l="${l}"><i></i></div>`).join('')}</div>
    <div class="mp-row"><label><input type="checkbox" class="mp-ov"> force intensity</label><input type="range" class="mp-ovv" min="0" max="1" step="0.01" value="0.5" style="flex:1"></div>
    <div class="mp-row">music vol <input type="range" class="mp-vol" min="0" max="1" step="0.01" value="0.35" style="flex:1"></div>
    <div class="mp-kv"></div>
  </div>`;
  document.body.append(panel);
  panel.querySelector('.mp-head')!.addEventListener('click', () => panel.classList.toggle('closed'));
  const ov = panel.querySelector<HTMLInputElement>('.mp-ov')!;
  const ovv = panel.querySelector<HTMLInputElement>('.mp-ovv')!;
  const syncOv = () => o.setOverride(ov.checked ? Number(ovv.value) : null);
  ov.addEventListener('change', syncOv);
  ovv.addEventListener('input', syncOv);
  panel.querySelector<HTMLInputElement>('.mp-vol')!.addEventListener('input', (e) => o.setVolume(Number((e.target as HTMLInputElement).value)));

  const cycle = (dir: number) => {
    o.cycle(dir);
    refresh();
  };
  const refresh = () => {
    const d = o.driver();
    bar.querySelector('.mp-label')!.textContent = `${d.key} · ${d.name}`;
    panel.querySelector('.mp-idea')!.textContent = d.idea;
  };
  refresh();

  let frame = 0;
  const update = () => {
    if (++frame % 6) return; // ~10 updates a second is plenty
    const s = o.snapshot();
    panel.querySelector<HTMLElement>('.mp-warn')!.hidden = s.running;
    panel.querySelector('.mp-num')!.textContent = s.level.toFixed(2);
    panel.querySelector<HTMLElement>('.mp-meter i')!.style.width = `${s.level * 100}%`;
    panel.querySelector<HTMLElement>('.mp-meter b')!.style.left = `${s.raw * 100}%`;
    for (const l of LAYERS) panel.querySelector<HTMLElement>(`[data-l="${l}"] i`)!.style.width = `${Math.min(1, s.gains[l]) * 100}%`;
    const i = s.inputs;
    panel.querySelector('.mp-kv')!.textContent = [
      `state     ${s.state}`,
      `mood      ${s.mood === 1 ? 'winning (major)' : s.mood === -1 ? 'losing (dark)' : 'neutral'}`,
      `filter    ${Math.round(s.cutoff)} Hz`,
      `lives     ${i.lives}   bullets ${i.bullets}`,
      `nearest   ${i.maxFlight.toFixed(2)} flight`,
      `pace      you ${i.pacePlayer.toFixed(1)}  enemy ${i.paceEnemy.toFixed(1)}`,
      `damage    ${Math.round(i.enemyDamage * 100)}%   time ${i.matchTime.toFixed(0)} s`,
    ].join('\n');
  };
  return { update, cycle };
}
