// The game's audio: one AudioContext, the buses the settings control, and the sounds, rendered in code.
import { busGains, type SoundSettings } from './soundSettings';

/** Where a sound plays: key clicks sit inside the effects, so the effects volume moves them too. */
export type Bus = 'effects' | 'keyClicks' | 'music';

export interface SoundDef {
  bus: Bus;
  /** The samples at `SAMPLE_RATE`; several are variants, one picked at random per play. */
  render: () => Float32Array | Float32Array[];
  /** At most this many plays at once; a new one cuts the oldest (default 8). */
  voices?: number;
  /** Each play's pitch varies by up to ± this fraction (0.05 = ±5%). */
  pitchJitter?: number;
  /** Each play's level varies by up to ± this many dB. */
  gainJitterDb?: number;
}

export type SoundBank = Record<string, SoundDef>;

/** The rate sounds are rendered at; the browser converts to the speakers' rate. */
export const SAMPLE_RATE = 44100;

// The slice of Web Audio the engine uses (the real AudioContext fits it; tests use a fake).
export interface ParamLike {
  value: number;
  setTargetAtTime(target: number, startTime: number, timeConstant: number): unknown;
  cancelScheduledValues(startTime: number): unknown;
}
export interface NodeLike {
  connect(node: never): unknown;
}
export interface GainLike extends NodeLike {
  gain: ParamLike;
}
export interface BufferLike {
  getChannelData(channel: number): Float32Array;
}
export interface SourceLike extends NodeLike {
  buffer: BufferLike | null;
  loop: boolean;
  playbackRate: ParamLike;
  onended: ((ev: never) => unknown) | null;
  start(): void;
  stop(when?: number): void;
}
export interface ContextLike {
  readonly state: string;
  readonly currentTime: number;
  readonly destination: NodeLike;
  resume(): Promise<void>;
  createGain(): GainLike;
  createBuffer(channels: number, length: number, sampleRate: number): BufferLike;
  createBufferSource(): SourceLike;
}

export interface AudioEngineOptions<C extends ContextLike, Id extends string> {
  /** Makes the AudioContext; returning null or throwing means no audio (the game plays silent). */
  createContext: () => C | null;
  sounds: Record<Id, SoundDef>;
  settings: SoundSettings;
  random?: () => number;
}

interface Buses {
  master: GainLike;
  effects: GainLike;
  keyClicks: GainLike;
  music: GainLike;
}

export class AudioEngine<C extends ContextLike = ContextLike, Id extends string = string> {
  private readonly ctx: C | null;
  private readonly buses: Buses | null = null;
  private readonly sounds: Record<Id, SoundDef>;
  private readonly random: () => number;
  /** Each sound's variants, rendered once the audio first runs. */
  private buffers: Map<Id, BufferLike[]> | null = null;
  /** Each sound's plays still sounding, oldest first. */
  private readonly voices = new Map<Id, SourceLike[]>();
  private readonly loops = new Map<Id, { src: SourceLike; level: GainLike; target: number }>();

  constructor(opts: AudioEngineOptions<C, Id>) {
    this.sounds = opts.sounds;
    this.random = opts.random ?? Math.random;
    const ctx = (this.ctx = tryCreate(opts.createContext));
    if (!ctx) return;
    const gain = () => ctx.createGain();
    const buses = (this.buses = { master: gain(), effects: gain(), keyClicks: gain(), music: gain() });
    connect(buses.master, ctx.destination);
    connect(buses.effects, buses.master);
    connect(buses.music, buses.master);
    connect(buses.keyClicks, buses.effects);
    this.applySettings(opts.settings);
  }

  /** The AudioContext (null without Web Audio): the music engine plays on it too. */
  get context(): C | null {
    return this.ctx;
  }

  /** Where the music connects: the music bus. */
  get musicInput(): ReturnType<C['createGain']> | null {
    return (this.buses?.music ?? null) as ReturnType<C['createGain']> | null;
  }

  /** Set the bus levels from the settings. */
  applySettings(settings: SoundSettings) {
    if (!this.buses) return;
    const g = busGains(settings);
    for (const bus of ['master', 'effects', 'keyClicks', 'music'] as const) this.buses[bus].gain.value = g[bus];
  }

  /** Play a sound once (nothing while the audio is blocked). */
  play(id: Id, gain = 1) {
    const list = this.ready()?.get(id);
    const def = this.sounds[id];
    if (!list?.length || !def) return;
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = list[Math.floor(this.random() * list.length)];
    src.playbackRate.value = 1 + this.spread() * (def.pitchJitter ?? 0);
    const level = ctx.createGain();
    level.gain.value = gain * 10 ** ((this.spread() * (def.gainJitterDb ?? 0)) / 20); // PROTOTYPE: `gain` (mix tuning)
    connect(src, level);
    connect(level, this.buses![def.bus]);
    const playing = this.voices.get(id) ?? [];
    this.voices.set(id, playing);
    if (playing.length >= (def.voices ?? 8)) playing.shift()!.stop();
    playing.push(src);
    src.onended = () => {
      const i = playing.indexOf(src);
      if (i >= 0) playing.splice(i, 1);
    };
    src.start();
  }

  /** Keep a sound looping at `level` (0 to 1); 0 fades it out and stops it. */
  setLoop(id: Id, level: number) {
    const ctx = this.ctx;
    const loop = this.loops.get(id);
    if (level <= 0) {
      if (!loop || !ctx) return;
      this.loops.delete(id);
      fadeTo(ctx, loop.level, 0);
      loop.src.stop(ctx.currentTime + LOOP_FADE * 4);
      return;
    }
    if (loop) {
      if (loop.target !== level) fadeTo(ctx!, loop.level, (loop.target = level));
      return;
    }
    const buffer = this.ready()?.get(id)?.[0];
    const def = this.sounds[id];
    if (!buffer || !def) return;
    const src = ctx!.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const gain = ctx!.createGain();
    gain.gain.value = 0;
    fadeTo(ctx!, gain, level);
    connect(src, gain);
    connect(gain, this.buses![def.bus]);
    src.start();
    this.loops.set(id, { src, level: gain, target: level });
  }

  /** A random number from -1 to 1. */
  private spread() {
    return this.random() * 2 - 1;
  }

  /** The rendered sounds, or null while the audio is blocked. Renders them the first time the audio runs. */
  private ready(): Map<Id, BufferLike[]> | null {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return null;
    if (!this.buffers) {
      this.buffers = new Map();
      for (const [id, def] of Object.entries(this.sounds) as [Id, SoundDef][]) {
        const made = def.render();
        this.buffers.set(id, (Array.isArray(made) ? made : [made]).map((data) => toBuffer(ctx, data)));
      }
    }
    return this.buffers;
  }

  /** The browser holds the audio until the player presses a key (no sound plays until then). */
  get blocked(): boolean {
    return !!this.ctx && this.ctx.state !== 'running';
  }

  /** Unlock on the page's key presses (not Escape: browsers don't count it) and clicks. */
  listen(target: EventTarget) {
    const onKey = (e: Event) => {
      if ((e as KeyboardEvent).key !== 'Escape') void this.unlock();
    };
    target.addEventListener('keydown', onKey, { capture: true });
    target.addEventListener('pointerdown', () => void this.unlock(), { capture: true });
  }

  /** Ask the browser to start the audio; call it inside a key press or click. True once it runs. */
  async unlock(): Promise<boolean> {
    const ctx = this.ctx;
    if (!ctx) return false;
    if (ctx.state !== 'running') await ctx.resume().catch(() => {});
    return !!this.ready();
  }
}

function tryCreate<C>(create: () => C | null): C | null {
  try {
    return create();
  } catch {
    return null;
  }
}

/** Seconds (time constant) a loop takes to fade in, out, or to a new level: no clicks. */
const LOOP_FADE = 0.08;

function fadeTo(ctx: ContextLike, node: GainLike, level: number) {
  node.gain.cancelScheduledValues(ctx.currentTime);
  node.gain.setTargetAtTime(level, ctx.currentTime, LOOP_FADE);
}

const connect = (from: NodeLike, to: NodeLike) => from.connect(to as never);

/** A buffer of the samples, scaled down only if they would clip (each sound's loudness is designed in). */
function toBuffer(ctx: ContextLike, data: Float32Array): BufferLike {
  let peak = 0;
  for (const v of data) peak = Math.max(peak, Math.abs(v));
  const scale = peak > 0.95 ? 0.95 / peak : 1;
  const buf = ctx.createBuffer(1, Math.max(1, data.length), SAMPLE_RATE);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) ch[i] = data[i] * scale;
  return buf;
}
