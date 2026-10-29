import type { FlowState } from '../flow/types';
import type { MatchStats } from '../match/MatchEngine';
import type { TextGrid } from '../render/AsciiRenderer';
import { matchStatsLines } from './content';
import { centered, put, twoTone, wrap, COLS } from './draw';

/** How the Match went, for the stats block. `enemyDamage` is 0..1. */
export interface OnlineStats {
  stats: MatchStats;
  enemyDamage: number;
}

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

type EndState = Extract<FlowState, { screen: 'end'; mode: 'versus' }>;

function statsBlock(text: TextGrid, row: number, online: OnlineStats | null, lost: boolean) {
  if (!online) return;
  const lines = matchStatsLines(online.stats, lost ? online.enemyDamage : null);
  const col = (COLS - Math.max(...lines.map((l) => l.length))) / 2;
  lines.forEach((l, i) => put(text, col, row + i, l, 'fg'));
}

/** The rows the Rematch menu takes, under the banner. */
export const REMATCH_ROW = 35;

/**
 * The online end screens as approved in the Win, Lose and Peace prototypes (variant A each). The Rematch strip
 * is drawn by the caller after this, from `REMATCH_ROW`.
 */
export function drawEnding(text: TextGrid, t: number, s: EndState, online: OnlineStats | null) {
  if (s.result === 'won') {
    // Victory sparks rise behind the text.
    for (let i = 0; i < 60; i++) {
      const x = Math.floor(hash(i * 3.1) * COLS);
      const y = 44 - ((t * (2 + hash(i) * 4) + hash(i * 7) * 44) % 44);
      put(text, x, y, hash(i * 5) > 0.7 ? '*' : '.', hash(i * 9) > 0.5 ? 'yellow' : 'green');
    }
    text.fill(0, 2, COLS, 20, ' ');
    twoTone(text, 3.5, 'YOU ', 'WIN', 7);
    centered(text, 15, 'THE ENEMY SHIP IS DESTROYED', 'green');
    statsBlock(text, 19, online, false);
  } else if (s.result === 'lost') {
    twoTone(text, 3.5, 'YOU ', 'LOSE', 7);
    centered(text, 15, 'YOUR SHIP WAS DESTROYED', 'red');
    statsBlock(text, 19, online, true);
    // A cold flicker line, like a dying monitor.
    if (hash(Math.floor(t * 9)) > 0.55) put(text, 20 + hash(Math.floor(t * 9) + 1) * 80, 17, '_'.repeat(8), 'dim');
  } else {
    if (t > 0.3) text.writeScaled((COLS - 'PEACE'.length * 8) / 2, 3.5, 'PEACE', 8, 'fg');
    centered(text, 15, 'NOBODY WON. NOBODY LOST.', 'fg');
    // Why it ended this way, as a gentle note. "RED WORD" is red, like the Attack word in the Cockpit.
    const parts: [string, 'dim' | 'red'][] = [
      ['BOTH SHIPS WENT QUIET AND FLEW AWAY, BECAUSE NEITHER PILOT CHOSE TO ATTACK WITH THE ', 'dim'],
      ['RED WORD', 'red'],
    ];
    let col = (COLS - parts.reduce((n, [x]) => n + x.length, 0)) / 2;
    parts.forEach(([x, c]) => {
      put(text, col, 17, x, c);
      col += x.length;
    });
    statsBlock(text, 21, online, false);
    // Spinoza, loosely translated (wording and attribution still to be checked before shipping).
    if (t > 1.4) {
      wrap('"PEACE IS NOT AN ABSENCE OF WAR, IT IS A VIRTUE, A STATE OF MIND, A DISPOSITION FOR BENEVOLENCE, CONFIDENCE, JUSTICE."', 62).forEach((l, i) => centered(text, 28.5 + i * 1.6, l, 'dim'));
      centered(text, 32, '- SPINOZA', 'dim');
    }
  }
}

/** The whole online end screen: the ending, then the Rematch strip (the plain one until the Rematch menu is built). */
export function drawOnlineEnd(text: TextGrid, t: number, s: Extract<FlowState, { screen: 'end' }>, online: OnlineStats | null) {
  if (s.mode !== 'versus') return;
  drawEnding(text, t, s, online);
  const r = s.rematch;
  const rematch =
    r.status === 'available' ? `[R] PROPOSE A REMATCH${r.secondsLeft === null ? '' : ` (${Math.ceil(r.secondsLeft)}S)`}`
    : r.status === 'waiting' ? `WAITING FOR THE OPPONENT TO ANSWER... ${Math.ceil(r.answerSecondsLeft)}S  [C] CANCEL`
    : r.status === 'incoming' ? `THE OPPONENT WANTS A REMATCH (${Math.ceil(r.answerSecondsLeft)}S): [R] ACCEPT  [D] DENY`
    : r.status === 'notice' ? { noAnswer: 'NO ANSWER', tooLate: 'TOO LATE', declined: 'DECLINED' }[r.notice]
    : r.status === 'opponentLeft' ? 'THE OPPONENT LEFT'
    : 'REMATCH CLOSED';
  centered(text, REMATCH_ROW, rematch, 'fg');
  centered(text, REMATCH_ROW + 2, s.kind === 'public' ? '[S] SEARCH FOR A NEW OPPONENT   [Q] MENU' : '[Q] MENU', 'dim');
}
