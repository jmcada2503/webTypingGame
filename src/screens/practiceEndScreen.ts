import type { ScreenFlow } from '../flow/ScreenFlow';
import type { FlowState } from '../flow/types';
import type { PracticeResult } from '../practice/PracticeSession';
import type { PlaySound } from '../audio/sounds';
import type { TextGrid } from '../render/AsciiRenderer';
import { SCORE_COUNT_SECONDS, countingScore, practiceDifficulty, practiceScore, practiceStatCells, practiceVerdict, settlePracticeBest } from './content';
import { COLS, blink, centered, put, twoTone } from './draw';
import { act, moved } from './screenSound';

type EndState = Extract<FlowState, { screen: 'end' }>;

const OPTIONS = ['PLAY AGAIN', 'MENU'] as const;
const fmt = (n: number) => n.toLocaleString('en-US');
/** The fastest the count-up ticks. */
const TICK_SECONDS = 0.07;

export interface PracticeEndSound {
  play?: PlaySound;
  /** The picture is on (no screen-change effect hides it): the count-up waits for it. */
  pictureOn?: () => boolean;
}

/** What the screen shows for the run that just ended, settled once when the screen comes up. */
interface Shown {
  result: PracticeResult;
  score: number;
  difficulty: number | null;
  bestBefore: number | null;
  newBest: boolean;
  /** Screen time the count-up started (the picture was back), or null while it waits. */
  countFrom: number | null;
  /** The number at the last tick, and when that tick played. */
  ticked: { value: number; t: number };
  /** NEW BEST has sounded. */
  cheered: boolean;
}

/**
 * The Practice game over (variant A of the Practice game over prototype): a huge GAME OVER, a small score that
 * counts up, then the session best (or NEW BEST!) and a verdict word, a 3×2 stat grid, and Play again / Menu as a
 * row (arrows or hjkl, Enter; Q goes to the menu).
 */
export function practiceEndScreen(flow: ScreenFlow, practiceResult: () => PracticeResult | null, storage: () => Pick<Storage, 'getItem' | 'setItem'> = () => sessionStorage, sound: PracticeEndSound = {}) {
  const play = sound.play ?? (() => {});
  const pictureOn = sound.pictureOn ?? (() => true);
  let sel = 0;
  let shown: Shown | null = null;

  return {
    enter(s: EndState) {
      if (s.mode !== 'practice') return;
      sel = 0;
      const result = practiceResult();
      if (!result) return void (shown = null);
      const score = practiceScore(result);
      shown = { result, score, difficulty: practiceDifficulty(result), ...settlePracticeBest(score, storage), countFrom: null, ticked: { value: 0, t: -1 }, cheered: false };
    },

    draw(text: TextGrid, t: number, s: EndState) {
      if (s.mode !== 'practice') return;
      twoTone(text, 2, 'GAME ', 'OVER', 6);
      if (shown) {
        if (shown.countFrom === null && pictureOn()) shown.countFrom = t;
        const counted = shown.countFrom === null ? 0 : t - shown.countFrom;
        const value = countingScore(shown.score, counted);
        if (value > shown.ticked.value && t - shown.ticked.t >= TICK_SECONDS - 1e-9) {
          shown.ticked = { value, t };
          play('scoreTick');
        }
        const done = counted > SCORE_COUNT_SECONDS;
        if (done && shown.ticked.value === shown.score && shown.newBest && !shown.cheered) {
          shown.cheered = true;
          play('newBest');
        }
        const label = `SCORE ${fmt(value)}`;
        text.writeScaled((COLS - label.length * 2) / 2, 11, label, 2, 'yellow');
        if (done) {
          if (shown.newBest) centered(text, 15, blink(t, 2) ? 'NEW BEST!' : '', 'green');
          else if (shown.bestBefore !== null) centered(text, 15, `BEST ${fmt(shown.bestBefore)}`, 'dim');
          centered(text, 17, practiceVerdict(shown.difficulty), 'fg');
        }
        practiceStatCells(shown.result).forEach(([label, value], i) => {
          const col = 28 + (i % 3) * 26;
          const row = 21 + Math.floor(i / 3) * 3;
          put(text, col, row, label, 'dim');
          put(text, col, row + 1, value, 'fg');
        });
      }
      const labels = OPTIONS.map((o, i) => (i === sel ? `> ${o} <` : `  ${o}  `));
      const gap = 8;
      let x = (COLS - labels.reduce((n, l) => n + l.length, 0) - gap) / 2;
      labels.forEach((l, i) => {
        put(text, x, 31, l, i === sel ? (blink(t, 3) ? 'yellow' : 'fg') : 'dim');
        x += l.length + gap;
      });
    },

    onKey(e: KeyboardEvent, s: EndState) {
      if (s.mode !== 'practice') return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'l' || k === 'j') sel = moved(play, sel, (sel + 1) % OPTIONS.length);
      else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'h' || k === 'k') sel = moved(play, sel, (sel + OPTIONS.length - 1) % OPTIONS.length);
      else if (k === 'Enter') act(flow, play, 'menuConfirm', () => (OPTIONS[sel] === 'PLAY AGAIN' ? flow.playAgain() : flow.backToMenu()));
      else if (k === 'q') act(flow, play, 'menuBack', () => flow.backToMenu());
    },
  };
}
