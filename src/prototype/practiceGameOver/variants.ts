// PROTOTYPE (throwaway): "Prototype: Practice game over screen".
// Question: how does a Practice run end (the ending scene after the last Life) and what does its game over screen
// show? Four variants in the real app (Practice from the menu), switchable on the game over screen with [ and ]
// (or ?go=A..D). Each variant pairs an ending scene with a screen; mixing is fine.
//   A Freeze + stamp  -> Arcade score (big counting score, best, verdict, stat grid)
//   B Power down      -> Run report (a log that types itself out, with your session best next to each number)
//   C Snap off        -> Difficulty chart (how far up the ramp you got over time, where you fell)
//   D Calm fade       -> Three big numbers (time, WPM, accuracy)
// The personal best lives in this browser tab only (sessionStorage) until there are accounts.
import type { ScreenFlow } from '../../flow/ScreenFlow';
import type { FlowState } from '../../flow/types';
import { PRACTICE_RAMP } from '../../practice/PracticeDirector';
import type { PracticeResult } from '../../practice/PracticeSession';
import type { PaletteColor, TextGrid } from '../../render/AsciiRenderer';
import { practiceScore } from '../../screens/content';
import { blink, box, centered, COLS, formatClock, put, twoTone } from '../../screens/draw';
import type { EndingFrame, EndingPlan } from '../../screens/endings';
import type { Screen } from '../../screens/Screen';
import { GLITCH, MATCH_START_HOLD, TV_OFF_ON } from '../../screens/ScreenTransition';

const params = new URLSearchParams(location.search);
const NAMES = ['A  FREEZE + ARCADE SCORE', 'B  POWER DOWN + RUN REPORT', 'C  SNAP OFF + DIFFICULTY CHART', 'D  CALM FADE + THREE BIG NUMBERS'];
export let variant = Math.max(0, 'ABCD'.indexOf((params.get('go') ?? 'A').toUpperCase()));

// ---------------------------------------------------------------- the ending scene (after the last Life)

/** The prototype's Practice ending: how long the scene plays, the effect into the screen, the scene frame, an overlay. */
export interface PracticeEnding {
  plan: EndingPlan;
  frame(t: number): EndingFrame;
  overlay?(text: TextGrid, t: number): void;
}

const base = (): EndingFrame => ({ enemyVisible: true, enemyOffset: { x: 0, y: 0, z: 0 }, pace: null, paceScale: 1, dim: 0 });
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function practiceEnding(): PracticeEnding {
  if (variant === 0) {
    // A: everything freezes on the spot and GAME OVER is stamped over the scene.
    return {
      plan: { sceneSeconds: 1.8, effect: GLITCH, hold: 0 },
      frame: () => ({ ...base(), pace: 0, dim: 0.3 }),
      overlay(text, t) {
        if (t < 0.15) return;
        const s = 'GAME OVER';
        const scale = 6;
        const c = (COLS - s.length * scale) / 2;
        if (t < 0.3) {
          text.writeScaled(c - 1.2, 14, s, scale, 'red');
          text.writeScaled(c + 1.2, 14, s, scale, 'green');
        }
        text.writeScaled(c, 14, s, scale, 'red');
      },
    };
  }
  if (variant === 1) {
    // B: the cockpit powers down (the stars slow to a stop, the lights dim), then TV off / on.
    return {
      plan: { sceneSeconds: 2.8, effect: TV_OFF_ON, hold: MATCH_START_HOLD },
      frame: (t) => ({ ...base(), paceScale: 1 - clamp01((t - 0.3) / 1), dim: Math.min(0.85, Math.max(0, (t - 0.4) * 0.5)) }),
    };
  }
  if (variant === 2) {
    // C: no scene at all: the picture snaps off at once (TV off, a short black, on).
    return { plan: { sceneSeconds: 0.25, effect: TV_OFF_ON, hold: 0.4 }, frame: () => base() };
  }
  // D: calm: the stars keep drifting slowly while the picture fades a little, then the glitch.
  return {
    plan: { sceneSeconds: 2.2, effect: GLITCH, hold: 0 },
    frame: (t) => ({ ...base(), paceScale: 0.3, dim: Math.min(0.6, t * 0.35) }),
  };
}

// ---------------------------------------------------------------- the run's history and the session best

/** Difficulty reached (0..1) over the run's time, sampled while Practice runs (for the chart). */
const history: { t: number; d: number }[] = [];
export function sampleRun(r: PracticeResult | null) {
  if (!r) return;
  if (history.length && r.survivedSeconds < history[history.length - 1].t) history.length = 0; // a new run
  const d = r.currentLevel === null ? 0 : Math.min(r.currentLevel, PRACTICE_RAMP.rampSeconds) / PRACTICE_RAMP.rampSeconds;
  if (!history.length || r.survivedSeconds - history[history.length - 1].t >= 0.25) history.push({ t: r.survivedSeconds, d });
}

interface Best {
  score: number;
  difficulty: number;
  wpm: number;
  survived: number;
}
const BEST_KEY = 'prototype.practiceBest';
function readBest(): Best | null {
  try {
    const raw = sessionStorage.getItem(BEST_KEY);
    return raw ? (JSON.parse(raw) as Best) : null;
  } catch {
    return null;
  }
}
function writeBest(b: Best) {
  try {
    sessionStorage.setItem(BEST_KEY, JSON.stringify(b));
  } catch {
    // private mode: no best, that's fine
  }
}

/** The run being shown and the best before it (so "NEW BEST" is about this run). */
let shown: { r: PracticeResult; score: number; difficulty: number; bestBefore: Best | null; newBest: boolean } | null = null;

function settle(r: PracticeResult) {
  const score = practiceScore(r);
  const difficulty = r.currentLevel === null ? 0 : Math.min(r.currentLevel, PRACTICE_RAMP.rampSeconds) / PRACTICE_RAMP.rampSeconds;
  const bestBefore = readBest();
  const newBest = score > 0 && (!bestBefore || score > bestBefore.score);
  if (newBest) writeBest({ score, difficulty, wpm: r.wpm, survived: r.survivedSeconds });
  shown = { r, score, difficulty, bestBefore, newBest };
}

// ---------------------------------------------------------------- the screens

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const pct = (x: number | null) => (x === null ? '-' : `${Math.round(x * 100)}%`);

/** A short verdict from how far up the ramp the run got. Encouraging: Practice is about getting better. */
function verdict(difficulty: number): string {
  if (difficulty < 0.2) return 'WARMING UP';
  if (difficulty < 0.4) return 'STEADY HANDS';
  if (difficulty < 0.6) return 'QUICK FINGERS';
  if (difficulty < 0.8) return 'ACE TYPIST';
  return 'UNSTOPPABLE';
}

const OPTIONS = ['PLAY AGAIN', 'MENU'];
let sel = 0;

/** The two choices as a row, hjkl / arrows + Enter (Q still goes to the menu). */
function optionsRow(text: TextGrid, row: number, t: number) {
  const labels = OPTIONS.map((o, i) => (i === sel ? `> ${o} <` : `  ${o}  `));
  const total = labels.reduce((n, l) => n + l.length, 0) + 8;
  let x = (COLS - total) / 2;
  labels.forEach((l, i) => {
    put(text, x, row, l, i === sel ? (blink(t, 3) ? 'yellow' : 'fg') : 'dim');
    x += l.length + 8;
  });
}

/** A: arcade: the score counts up big, then the best, a verdict, and the numbers in a grid. */
function drawArcade(text: TextGrid, t: number) {
  const s = shown!;
  twoTone(text, 2.5, 'GAME ', 'OVER', 3);
  const counted = s.score * clamp01(t / 1.2);
  const label = fmt(counted);
  text.writeScaled((COLS - label.length * 6) / 2, 8, label, 6, 'yellow');
  centered(text, 15.5, 'SCORE', 'dim');
  if (t > 1.2) {
    if (s.newBest) centered(text, 17.5, blink(t, 2) ? 'NEW BEST!' : '', 'green');
    else if (s.bestBefore) centered(text, 17.5, `BEST ${fmt(s.bestBefore.score)}`, 'dim');
    centered(text, 19.5, verdict(s.difficulty), 'fg');
  }
  const cells: [string, string][] = [
    ['TIME', formatClock(s.r.survivedSeconds)],
    ['DIFFICULTY', `${Math.round(s.difficulty * 100)}%`],
    ['WORDS', String(s.r.wordsTyped)],
    ['WPM', String(Math.round(s.r.wpm))],
    ['ACCURACY', pct(s.r.accuracy)],
    ['BEST PACE', `${s.r.peakPace.toFixed(1)} L/S`],
  ];
  cells.forEach(([k, v], i) => {
    const col = 28 + (i % 3) * 26;
    const row = 23 + Math.floor(i / 3) * 3;
    put(text, col, row, k, 'dim');
    put(text, col, row + 1, v, 'fg');
  });
  optionsRow(text, 33, t);
}

/** B: a run report that types itself out, line by line, with the session best next to the numbers. */
function drawReport(text: TextGrid, t: number) {
  const s = shown!;
  const b = s.bestBefore;
  box(text, 22, 4, 84, 30, 'dim');
  put(text, 25, 4, ' RUN REPORT ', 'yellow');
  const lines: [string, PaletteColor][] = [
    ['> LAST LIFE LOST. PRACTICE OVER.', 'red'],
    [`> TIME SURVIVED      ${formatClock(s.r.survivedSeconds)}${b ? `   (BEST ${formatClock(b.survived)})` : ''}`, 'fg'],
    [`> DIFFICULTY REACHED ${Math.round(s.difficulty * 100)}%${b ? `   (BEST ${Math.round(b.difficulty * 100)}%)` : ''}`, 'fg'],
    [`> WORDS TYPED        ${s.r.wordsTyped}`, 'fg'],
    [`> ACCURACY           ${pct(s.r.accuracy)}`, 'fg'],
    [`> PACE               ${s.r.averagePace.toFixed(1)} L/S = ${Math.round(s.r.wpm)} WPM${b ? `   (BEST ${Math.round(b.wpm)} WPM)` : ''}`, 'fg'],
    [`> SCORE              ${fmt(s.score)}${s.newBest ? '   NEW BEST' : b ? `   (BEST ${fmt(b.score)})` : ''}`, s.newBest ? 'green' : 'yellow'],
    ['', 'fg'],
    [`> ${verdict(s.difficulty)}`, 'fg'],
  ];
  const shownLines = Math.min(lines.length, Math.floor(t / 0.22));
  lines.slice(0, shownLines).forEach(([l, c], i) => put(text, 27, 7 + i * 2, l, c));
  if (shownLines < lines.length && blink(t, 4)) put(text, 27, 7 + shownLines * 2, '_', 'fg');
  if (shownLines >= lines.length) optionsRow(text, 30, t);
}

/** C: how far up the ramp the run climbed over time, with where it fell; the key numbers beside it. */
function drawChart(text: TextGrid, t: number) {
  const s = shown!;
  twoTone(text, 2, 'GAME ', 'OVER', 2.4);
  const c0 = 12;
  const r0 = 8;
  const w = 70;
  const h = 20;
  for (let r = 0; r <= h; r++) put(text, c0 - 1, r0 + r, r === h ? '+' : '|', 'dim');
  put(text, c0, r0 + h, '-'.repeat(w), 'dim');
  put(text, c0 - 6, r0, '100%', 'dim');
  put(text, c0 - 4, r0 + h, '0%', 'dim');
  put(text, c0, r0 + h + 1, '0:00', 'dim');
  const end = formatClock(s.r.survivedSeconds);
  put(text, c0 + w - end.length, r0 + h + 1, end, 'dim');
  centered(text, r0 + h + 2.5, 'DIFFICULTY OVER THE RUN', 'dim');
  if (s.bestBefore) {
    const by = r0 + h - Math.round(s.bestBefore.difficulty * h);
    for (let c = 0; c < w; c += 2) put(text, c0 + c, by, '.', 'green');
    put(text, c0 + w + 1, by, 'BEST', 'green');
  }
  const total = Math.max(1, s.r.survivedSeconds);
  const drawn = Math.min(history.length, Math.floor(history.length * clamp01(t / 1.2)) + 1);
  for (let i = 0; i < drawn; i++) {
    const p = history[i];
    put(text, c0 + Math.min(w - 1, Math.round((p.t / total) * (w - 1))), r0 + h - Math.round(p.d * h), '*', 'yellow');
  }
  if (t > 1.2 && history.length) {
    const last = history[history.length - 1];
    put(text, c0 + w - 1, r0 + h - Math.round(last.d * h), 'X', 'red');
  }
  const side: [string, string, PaletteColor][] = [
    ['SCORE', fmt(s.score), 'yellow'],
    ['TIME', formatClock(s.r.survivedSeconds), 'fg'],
    ['WPM', String(Math.round(s.r.wpm)), 'fg'],
    ['ACCURACY', pct(s.r.accuracy), 'fg'],
  ];
  side.forEach(([k, v, c], i) => {
    put(text, 96, r0 + 1 + i * 4, k, 'dim');
    put(text, 96, r0 + 2 + i * 4, v, c);
  });
  if (s.newBest && t > 1.2) put(text, 96, r0 + 17, blink(t, 2) ? 'NEW BEST!' : '', 'green');
  put(text, 96, r0 + 19, verdict(s.difficulty), 'fg');
  optionsRow(text, 36, t);
}

/** D: three big numbers and little else. */
function drawThree(text: TextGrid, t: number) {
  const s = shown!;
  centered(text, 3, `GAME OVER   SCORE ${fmt(s.score)}${s.newBest ? '   NEW BEST!' : ''}`, s.newBest ? 'green' : 'fg');
  const big: [string, string][] = [
    [formatClock(s.r.survivedSeconds), 'TIME'],
    [String(Math.round(s.r.wpm)), 'WPM'],
    [pct(s.r.accuracy), 'ACCURACY'],
  ];
  big.forEach(([v, k], i) => {
    const cx = 22 + i * 42;
    if (t > i * 0.25) {
      text.writeScaled(cx - (v.length * 5) / 2, 10, v, 5, 'yellow');
      put(text, cx - k.length / 2, 17, k, 'dim');
    }
  });
  if (t > 0.9) centered(text, 22, verdict(s.difficulty), 'fg');
  optionsRow(text, 28, t);
}

const DRAW = [drawArcade, drawReport, drawChart, drawThree];

/** Wraps the app's end screen: Practice gets the prototype variants, online Matches stay as they are. */
export function practiceEndScreen(real: Screen, flow: ScreenFlow, result: () => PracticeResult | null): Screen {
  const isPractice = (s: FlowState) => s.screen === 'end' && s.mode === 'practice';
  return {
    enter(s) {
      sel = 0;
      const r = result();
      if (isPractice(s) && r) settle(r);
      real.enter?.(s);
    },
    draw(text, t, s) {
      if (!isPractice(s) || !shown) return real.draw(text, t, s);
      DRAW[variant](text, t);
      put(text, 2, 43, `PROTOTYPE  VARIANT ${NAMES[variant]}    [ ] SWITCH (THE ENDING SCENE CHANGES NEXT RUN)`, 'dim');
    },
    onKey(e, s) {
      if (!isPractice(s) || !shown) return real.onKey?.(e, s);
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === '[' || k === ']') variant = (variant + (k === ']' ? 1 : 3)) % 4;
      else if (k === 'h' || k === 'k' || k === 'ArrowLeft' || k === 'ArrowUp') sel = (sel + 1) % 2;
      else if (k === 'l' || k === 'j' || k === 'ArrowRight' || k === 'ArrowDown') sel = (sel + 1) % 2;
      else if (k === 'Enter') return sel === 0 ? flow.playAgain() : flow.backToMenu();
      else if (k === 'q') flow.backToMenu();
    },
  };
}
