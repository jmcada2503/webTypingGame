// The adaptive music (Adaptive music prototype, Blend driver): one chiptune piece in the Arcade style, composed in
// code with Tone.js on the game's AudioContext, into the music bus. 120 BPM (2 beats per Countdown second), 2 s
// bars, a 4-bar loop. Layers join the Match by intensity (see layers.ts) under a low-pass that opens with it; the
// screens get their own mixes, the Countdown a riser timed so the Match starts on a downbeat, the endings stingers.
// Loaded on its own (Tone.js is big) once the audio runs.
import * as Tone from 'tone';
import { blendIntensity, smoothIntensity, type MusicInputs, type Mood } from './intensity';
import { LAYERS, startLayers, stepLayers, type Layer } from './layers';
import type { MusicState } from './musicState';

/** Each layer's level when it plays in the Match. */
const LEVEL: Record<Layer, number> = { pad: 0.5, bass: 0.55, kick: 0.8, snare: 0.45, hats: 0.25, arp: 0.3, lead: 0.32 };

/** Which layers each screen state plays, and the filter. `null` = the Match's adaptive rule. */
const STATE_MIX: Record<MusicState, { layers: Partial<Record<Layer, number>>; cutoff: number } | null> = {
  menu: { layers: { pad: 0.45, arp: 0.18, bass: 0.25 }, cutoff: 1600 },
  countdown: { layers: { pad: 0.45, bass: 0.45, kick: 0.6 }, cutoff: 2500 },
  starting: { layers: { pad: 0.35 }, cutoff: 350 },
  match: null,
  held: { layers: { pad: 0.4, bass: 0.3 }, cutoff: 450 },
  endingWin: { layers: {}, cutoff: 6000 },
  endingLose: { layers: {}, cutoff: 300 },
  endingPeace: { layers: {}, cutoff: 900 },
  end: { layers: { pad: 0.4, arp: 0.12, bass: 0.15 }, cutoff: 1300 },
};

// Harmony: 4 bars per mood. Chords as [bass root, ...pad notes].
const PROGRESSIONS: Record<Mood, string[][]> = {
  0: [['A1', 'A3', 'C4', 'E4'], ['F1', 'F3', 'A3', 'C4'], ['C2', 'C4', 'E4', 'G4'], ['G1', 'G3', 'B3', 'D4']], // Am F C G
  1: [['C2', 'C4', 'E4', 'G4'], ['G1', 'G3', 'B3', 'D4'], ['A1', 'A3', 'C4', 'E4'], ['F1', 'F3', 'A3', 'C4']], // C G Am F
  [-1]: [['A1', 'A3', 'C4', 'E4'], ['A#1', 'A#3', 'D4', 'F4'], ['A1', 'A3', 'C4', 'E4'], ['E1', 'E3', 'G#3', 'B3']], // Am Bb Am E
};
/** Lead: chord-tone indices per 8th note, a 4-bar phrase (-1 = rest). */
const LEAD_SHAPE = [
  [2, -1, 1, -1, 0, 1, 2, -1],
  [3, -1, 2, -1, 1, -1, 2, 1],
  [2, -1, 1, -1, 0, 1, 2, 3],
  [3, 2, 1, -1, 0, -1, -1, -1],
];
const up = (n: string, oct: number) => n.replace(/\d$/, (d) => String(Number(d) + oct));
/** Countdown (5 s) + TV gap (1.8 s) = 6.8 s: start the clock 1.2 s into a bar so the Match lands on a downbeat. */
const COUNTDOWN_CLOCK = 1.2;
/** Practice has only the 1.8 s gap. */
const PRACTICE_GAP_CLOCK = 0.2;

export class MusicPlayer {
  private readonly transport = Tone.getTransport();
  private readonly filter = new Tone.Filter(800, 'lowpass');
  private readonly bus: Tone.Gain;
  private readonly layerGain: Record<Layer, Tone.Gain>;
  private readonly synths;
  private state: MusicState = 'menu';
  private layers = startLayers();
  private smooth = 0;
  private mood: Mood = 0;
  private barMood: Mood = 0;
  private endMood: Mood = 0;
  private matchTime = 0;

  constructor(output: AudioNode) {
    this.bus = new Tone.Gain(1);
    this.bus.connect(output);
    this.filter.connect(this.bus);
    this.layerGain = Object.fromEntries(LAYERS.map((l) => [l, new Tone.Gain(0).connect(this.filter)])) as Record<Layer, Tone.Gain>;
    const g = this.layerGain;
    const bus = this.bus;
    const echo = new Tone.FeedbackDelay({ delayTime: '8n.', feedback: 0.4, wet: 0.45 }).connect(bus);
    const riserFilter = new Tone.Filter(300, 'bandpass').connect(bus);
    const riserGain = new Tone.Gain(0).connect(riserFilter);
    this.synths = {
      pad: new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'triangle' }, envelope: { attack: 0.3, decay: 0.4, sustain: 0.6, release: 1.2 }, volume: -10 }).connect(g.pad),
      bass: new Tone.MonoSynth({ oscillator: { type: 'square' }, filter: { Q: 1, type: 'lowpass' }, filterEnvelope: { attack: 0.005, decay: 0.15, sustain: 0.3, baseFrequency: 200, octaves: 2.5 }, envelope: { attack: 0.005, decay: 0.1, sustain: 0.5, release: 0.1 }, volume: -8 }).connect(g.bass),
      kick: new Tone.MembraneSynth({ pitchDecay: 0.03, octaves: 6, envelope: { attack: 0.001, decay: 0.25, sustain: 0 }, volume: -4 }).connect(g.kick),
      snare: new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.12, sustain: 0 }, volume: -10 }).connect(g.snare),
      hats: new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.03, sustain: 0 }, volume: -16 }).connect(new Tone.Filter(7000, 'highpass').connect(g.hats)),
      arp: new Tone.Synth({ oscillator: { type: 'square' }, envelope: { attack: 0.002, decay: 0.08, sustain: 0.2, release: 0.05 }, volume: -16 }).connect(g.arp),
      lead: new Tone.Synth({ oscillator: { type: 'square' }, envelope: { attack: 0.01, decay: 0.15, sustain: 0.4, release: 0.15 }, volume: -14 }).connect(g.lead),
      // Win fanfare: lead + a harmony voice, bass and a crash.
      fanfare: new Tone.Synth({ oscillator: { type: 'square' }, envelope: { attack: 0.002, decay: 0.1, sustain: 0.3, release: 0.3 }, volume: -10 }).connect(bus),
      fanfare2: new Tone.Synth({ oscillator: { type: 'square' }, envelope: { attack: 0.002, decay: 0.1, sustain: 0.35, release: 0.3 }, volume: -17 }).connect(bus),
      fanfareBass: new Tone.Synth({ oscillator: { type: 'triangle' }, envelope: { attack: 0.005, decay: 0.3, sustain: 0.6, release: 0.6 }, volume: -6 }).connect(bus),
      fanfarePad: new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'triangle' }, envelope: { attack: 0.05, decay: 0.5, sustain: 0.5, release: 2.5 }, volume: -10 }).connect(bus),
      crash: new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 1.6, sustain: 0 }, volume: -20 }).connect(new Tone.Filter(5000, 'highpass').connect(bus)),
      // Peace: soft bell-like notes through an echo, the ship drifting away.
      peaceBell: new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'triangle' }, envelope: { attack: 0.01, decay: 0.8, sustain: 0.15, release: 1.8 }, volume: -12 }).connect(echo),
      peacePad: new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'sine' }, envelope: { attack: 0.8, decay: 0.5, sustain: 0.7, release: 2.5 }, volume: -14 }).connect(bus),
      riser: new Tone.Noise('white').connect(riserGain),
      riserGain,
      riserFilter,
    };
    this.transport.bpm.value = 120;
    this.transport.scheduleRepeat((time) => this.sixteenth(time), '16n');
    this.transport.start();
    this.applyMix(Tone.now(), true);
  }

  /** Every frame: follow the game. `inputs` only matter in the Match. */
  update(dt: number, state: MusicState, inputs: (matchTime: number) => MusicInputs | null, endMood: Mood) {
    if (state === 'match' && this.state !== 'match' && this.state !== 'held') this.matchTime = 0;
    this.endMood = endMood;
    this.setState(state);
    if (this.state !== 'match') return;
    this.matchTime += dt;
    const i = inputs(this.matchTime);
    if (!i) return;
    const r = blendIntensity(i);
    this.mood = r.mood;
    this.smooth = smoothIntensity(this.smooth, r.intensity, dt);
  }

  /** The score: one 16th-note callback plays every layer (silent layers sit at gain 0). */
  private sixteenth(time: number) {
    const { pad, bass, kick, snare, hats, arp, lead } = this.synths;
    const step = Math.round(this.transport.getTicksAtTime(time) / (this.transport.PPQ / 4)) % 64;
    const bar = Math.floor(step / 16);
    const s = step % 16;
    if (s === 0) this.barMood = this.state === 'end' ? this.endMood : this.mood; // harmony changes only on the bar
    const chord = PROGRESSIONS[this.barMood][bar];
    const v = this.state === 'match' ? this.smooth : 0.3;
    if (s % 4 === 0) this.applyMix(time, s === 0);
    if (s === 0) pad.triggerAttackRelease(chord.slice(1), '1m', time, 0.6);
    if (s % 2 === 0) bass.triggerAttackRelease(s % 8 === 6 && v > 0.6 ? up(chord[0], 1) : chord[0], '16n', time, 0.8);
    if (s === 0 || s === 8 || (v > 0.8 && s === 10) || (this.state === 'countdown' && s % 4 === 0)) kick.triggerAttackRelease('C1', '8n', time);
    if (s === 4 || s === 12 || (v > 0.85 && bar === 3 && s >= 13)) snare.triggerAttackRelease('16n', time, s >= 13 ? 0.5 : 0.8);
    if (v > 0.8 || s % 2 === 0) hats.triggerAttackRelease('32n', time, s % 4 === 2 ? 0.9 : 0.5);
    const tones = [...chord.slice(1), up(chord[1], 1)].map((n) => up(n, 1));
    arp.triggerAttackRelease(tones[(v > 0.85 ? s : Math.floor(s / 2)) % 4], '32n', time, 0.7);
    if (s % 2 === 0) {
      const idx = LEAD_SHAPE[bar][s / 2];
      if (idx >= 0) lead.triggerAttackRelease(tones[idx], '8n', time, 0.7);
    }
  }

  /** Every beat: the layer levels and the filter, on the audio clock. */
  private applyMix(time: number, barStart: boolean) {
    const mix = STATE_MIX[this.state];
    if (mix) {
      for (const l of LAYERS) this.layerGain[l].gain.rampTo(mix.layers[l] ?? 0, this.state.startsWith('ending') ? 0.4 : 0.6, time);
      this.filter.frequency.rampTo(mix.cutoff, 0.8, time);
      return;
    }
    const v = this.smooth;
    this.layers = stepLayers(this.layers, v, barStart);
    for (const l of LAYERS) this.layerGain[l].gain.rampTo(this.layers.on[l] ? LEVEL[l] * (l === 'pad' && v > 0.7 ? 0.8 : 1) : 0, 0.3, time);
    this.filter.frequency.rampTo(500 + 11500 * v ** 2, 0.5, time);
  }

  private setState(next: MusicState) {
    if (next === this.state) return;
    const prev = this.state;
    this.state = next;
    const { riser, riserGain, riserFilter } = this.synths;
    const beat = this.transport.nextSubdivision('4n');
    if (next === 'countdown') {
      this.transport.seconds = COUNTDOWN_CLOCK;
      riser.start();
      riserGain.gain.rampTo(0.12, 4.5);
      riserFilter.frequency.value = 300;
      riserFilter.frequency.rampTo(5000, 5);
    }
    if (next === 'starting' && prev !== 'countdown') this.transport.seconds = PRACTICE_GAP_CLOCK;
    if (prev === 'countdown') {
      riserGain.gain.rampTo(0, 0.05);
      riser.stop('+0.2');
    }
    if (next === 'match' && prev !== 'held') {
      this.smooth = 0.15;
      this.layers = startLayers();
    }
    if (next === 'endingWin') this.fanfare(beat);
    if (next === 'endingPeace') this.peace(beat);
    this.applyMix(Tone.now(), true);
  }

  /** A short victory fanfare: pickup triplet, a held G, a turn, then a big C major landing with crash and bass. */
  private fanfare(at: number) {
    const { fanfare, fanfare2, fanfareBass, fanfarePad, crash, kick } = this.synths;
    const lead: [string, number, number][] = [['G4', 0, 0.1], ['C5', 0.1, 0.1], ['E5', 0.2, 0.1], ['G5', 0.3, 0.32], ['E5', 0.68, 0.12], ['G5', 0.84, 0.12], ['C6', 1.0, 1.4]];
    const harm: [string, number, number][] = [['E4', 0.3, 0.32], ['C5', 0.68, 0.12], ['E5', 0.84, 0.12], ['G5', 1.0, 1.4]];
    lead.forEach(([n, t, d]) => fanfare.triggerAttackRelease(n, d, at + t));
    harm.forEach(([n, t, d]) => fanfare2.triggerAttackRelease(n, d, at + t));
    fanfareBass.triggerAttackRelease('G2', 0.6, at + 0.3);
    fanfareBass.triggerAttackRelease('C2', 1.6, at + 1.0);
    kick.triggerAttackRelease('C1', '8n', at + 0.3); // through the kick layer, fading out with the Match mix
    kick.triggerAttackRelease('C1', '8n', at + 1.0);
    crash.triggerAttackRelease(1.6, at + 1.0);
    fanfarePad.triggerAttackRelease(['C4', 'E4', 'G4', 'C5'], 2, at + 1.0);
  }

  /** Calm and open: a rising Fmaj9 arpeggio, then Cmaj9, soft pads underneath, echoing away. */
  private peace(at: number) {
    const { peaceBell, peacePad } = this.synths;
    peacePad.triggerAttackRelease(['F3', 'A3', 'C4', 'E4'], 2.2, at);
    ['F4', 'A4', 'C5', 'E5', 'G5'].forEach((n, i) => peaceBell.triggerAttackRelease(n, 0.4, at + i * 0.3, 0.7));
    peacePad.triggerAttackRelease(['C4', 'E4', 'G4', 'B4'], 2.6, at + 2.2);
    ['C5', 'E5', 'G5', 'B5', 'D6'].forEach((n, i) => peaceBell.triggerAttackRelease(n, 0.5, at + 2.2 + i * 0.3, 0.6 - i * 0.08));
  }
}

/** Start the music on the game's AudioContext, into `output` (the music bus). */
export function startMusic(ctx: AudioContext, output: AudioNode): MusicPlayer {
  Tone.setContext(ctx);
  return new MusicPlayer(output);
}
