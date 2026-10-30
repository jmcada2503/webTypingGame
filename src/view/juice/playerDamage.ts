import type { PaletteColor } from '../../render/AsciiRenderer';

/** 0 = intact, 1 = light (2 Lives), 2 = bad (1 Life, and 0 while the Lose ending plays). */
export type DamageLevel = 0 | 1 | 2;

/** The two side consoles: Lives on the left, Radar on the right. */
export type Console = 'lives' | 'radar';

/** What a damage level breaks ("Prototype: Player damage", variant E). Times in seconds. */
export interface DamageSettings {
  /** Smoke puffs per second (× `PLAYER_DAMAGE_LOOK.smoke`) and the consoles they rise from. */
  smokePerSecond: number;
  smokeFrom: Console[];
  /** Red embers: the share of puffs that start red. */
  embers: number;
  /** Seconds between small spark spits, random in [min, max]. */
  sparkEvery: [number, number];
  /** Consoles that flicker dark in brief dips, and how rare a dip is (noise above this, -1..1). */
  flicker: Console[];
  flickerAbove: number;
  /** Switches that are dead, by index on each console (5 per console, left to right). */
  deadSwitches: Record<Console, number[]>;
  /** The warning on the Lives console, between the lamps and its label. `blinkHz` 0 = steady. */
  warning: { text: string; color: PaletteColor; blinkHz: number };
  /** Radar glitches: seconds between them, random in [min, max], and how long each lasts. */
  glitchEvery: [number, number];
  glitchSeconds: number;
  /** Steady tremble of the lower structure, world units (× `PLAYER_DAMAGE_LOOK.tremble`). */
  tremble: number;
  /** The LIVES / RADAR labels stutter. */
  labelsStutter: boolean;
}

export const DAMAGE_LEVELS: Record<1 | 2, DamageSettings> = {
  1: {
    smokePerSecond: 22,
    smokeFrom: ['lives'],
    embers: 0,
    sparkEvery: [1.8, 3.8],
    flicker: ['lives'],
    flickerAbove: 0.75,
    deadSwitches: { lives: [1, 3], radar: [] },
    warning: { text: 'HULL DAMAGED', color: 'yellow', blinkHz: 0 },
    glitchEvery: [3, 6],
    glitchSeconds: 0.2,
    tremble: 0.002,
    labelsStutter: false,
  },
  2: {
    smokePerSecond: 60,
    smokeFrom: ['lives', 'radar'],
    embers: 0.25,
    sparkEvery: [0.4, 1.2],
    flicker: ['lives', 'radar'],
    flickerAbove: 0.55,
    deadSwitches: { lives: [1, 3], radar: [0, 2, 4] },
    warning: { text: '!! HULL CRITICAL !!', color: 'red', blinkHz: 1.5 },
    glitchEvery: [0.8, 2],
    glitchSeconds: 0.35,
    tremble: 0.006,
    labelsStutter: true,
  },
};

export function damageLevel(lives: number): DamageLevel {
  return lives >= 3 ? 0 : lives === 2 ? 1 : 2;
}

/** The damage level a Life lost has just reached, or null if nothing new broke (the last Life, no loss, a refill). */
export function markedLevel(prevLives: number, lives: number): 1 | 2 | null {
  const level = damageLevel(lives);
  return lives < prevLives && level > damageLevel(prevLives) ? (level as 1 | 2) : null;
}

/** The console that breaks at a new level: the spark burst comes from it. */
export const markConsole = (level: 1 | 2): Console => (level === 1 ? 'lives' : 'radar');

/** How much the lower structure trembles: the level's steady tremble plus the jolt after a Life lost, fading out. */
export function trembleAmplitude(level: DamageLevel, sinceMark: number, look: { tremble: number; jolt: number; joltSeconds: number }): number {
  const steady = level === 0 ? 0 : DAMAGE_LEVELS[level].tremble * look.tremble;
  const k = Math.max(0, 1 - sinceMark / look.joltSeconds);
  return steady + look.jolt * k * k;
}
