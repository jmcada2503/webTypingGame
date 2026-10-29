/**
 * The Idle nudge on the Attack word (decided in "Prototype: Idle nudge animation", variant B): after 5 s without
 * typing, a yellow `V` marker bobs above the word with a slow-blinking `TYPE IT` hint and a flashing underline; the
 * word pops yellow for a moment when it starts. When the opponent is Idle too it runs faster, with a `PEACE IN n` label.
 * Pure timing here; the Cockpit draws it.
 */
export const NUDGE = {
  /** The Attack word is yellow for this long (s) when the nudge starts. */
  popSeconds: 0.35,
  /** The marker's bob: radians per second and how far (grid rows) each way. */
  bobSpeed: 5,
  bobRows: 0.7,
  /** Blink rates (toggles per second: it is on for 1/Hz s, then off for 1/Hz s): the hint is slow, the underline quicker. */
  hintHz: 1.2,
  underlineHz: 2,
  /** How much faster it all runs when the opponent is Idle too. */
  fast: 1.8,
} as const;

export interface NudgeLook {
  /** The Attack word is yellow (the opening pop). */
  popping: boolean;
  /** Rows to move the marker up (-) / down (+) from its resting place above the word. */
  markerOffset: number;
  /** Show the `TYPE IT` hint now. */
  hint: boolean;
  /** The underline is yellow now (dim otherwise). */
  underlineLit: boolean;
}

const blinkOn = (t: number, hz: number) => Math.floor(t * hz) % 2 === 0;

/** The look `t` seconds after the nudge started; `fast` when the opponent is Idle too. */
export function nudgeLook(t: number, fast: boolean): NudgeLook {
  const r = fast ? NUDGE.fast : 1;
  return {
    popping: t < NUDGE.popSeconds,
    markerOffset: Math.sin(t * r * NUDGE.bobSpeed) * NUDGE.bobRows,
    hint: blinkOn(t * r, NUDGE.hintHz),
    underlineLit: blinkOn(t * r, NUDGE.underlineHz),
  };
}

/** The label while both players are Idle: whole seconds left, rounded up; `PEACE!!` at zero. */
export function peaceLabel(peaceIn: number): string {
  return peaceIn > 0 ? `PEACE IN ${Math.ceil(peaceIn)}` : 'PEACE!!';
}
