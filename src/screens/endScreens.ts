import type { ScreenFlow } from '../flow/ScreenFlow';
import type { FlowState } from '../flow/types';
import type { MatchStats } from '../match/MatchEngine';
import type { TextGrid } from '../render/AsciiRenderer';
import { matchStatsLines } from './content';
import { blink, centered, put, twoTone, wrap, COLS } from './draw';
import { rematchMenu } from './rematchMenu';

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

/** The first row of the Rematch menu: Peace has a quote above it, so it sits lower. */
const rematchRow = (result: 'won' | 'lost' | 'peace') => (result === 'peace' ? 35 : 32);

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

const STRIP = { c0: 24, w: 80 };
const clampSel = (sel: number, n: number) => Math.max(0, Math.min(sel, n - 1));

/**
 * The online end screen with the Rematch menu under the banner (the "edge bar" layout of the Rematch prototype): a
 * status line, a row of choices (arrows or hjkl, Enter), and a thin bar along the bottom for the window or the
 * answer time. Used by Win, Lose and Peace alike.
 */
export function onlineEndScreen(flow: ScreenFlow, onlineStats: () => OnlineStats | null) {
  let sel = 0;
  let lastIds = '';
  const current = (s: Extract<FlowState, { screen: 'end'; mode: 'versus' }>) => rematchMenu(s.rematch, s.kind);

  return {
    draw(text: TextGrid, t: number, s: Extract<FlowState, { screen: 'end' }>) {
      if (s.mode !== 'versus') return;
      drawEnding(text, t, s, onlineStats());
      const menu = current(s);
      // A new set of choices starts on the first one; a shrinking set keeps the cursor in range.
      const ids = menu.options.map((o) => o.id).join();
      if (ids !== lastIds) sel = 0;
      lastIds = ids;
      sel = clampSel(sel, menu.options.length);

      const { status, bar } = menu;
      const r0 = rematchRow(s.result);
      if (status) {
        const label = status.text + (status.dots ? '.'.repeat(1 + (Math.floor(t * 2.5) % 3)) : '');
        const color = status.text === 'OPPONENT WANTS A REMATCH' && !blink(t, 3) ? 'fg' : status.color;
        text.writeScaled((COLS - [...status.text].length * 1.4) / 2, r0 + 1, label, 1.4, color);
      }
      const labels = menu.options.map((o, i) => (i === sel ? `> ${o.label} <` : `  ${o.label}  `));
      const gap = 6;
      const total = labels.reduce((n, l) => n + [...l].length, 0) + gap * Math.max(0, labels.length - 1);
      let x = (COLS - total) / 2;
      labels.forEach((l, i) => {
        put(text, x, r0 + 5, l, i === sel ? (blink(t, 3) ? 'yellow' : 'fg') : 'dim');
        x += [...l].length + gap;
      });
      if (bar) {
        const filled = Math.round(STRIP.w * bar.fraction);
        const fill = bar.kind === 'window' ? '=' : '-';
        put(text, STRIP.c0, r0 + 8, fill.repeat(filled), bar.color);
        if (bar.kind === 'window') put(text, STRIP.c0 + filled, r0 + 8, '.'.repeat(STRIP.w - filled), 'dim');
        put(text, STRIP.c0 + STRIP.w + 1, r0 + 8, `${bar.seconds} S`, bar.color);
        if (bar.caption) put(text, STRIP.c0, r0 + 9, bar.caption, 'dim');
      }
    },

    onKey(e: KeyboardEvent, s: Extract<FlowState, { screen: 'end' }>) {
      if (s.mode !== 'versus') return;
      const options = current(s).options;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'l' || k === 'j') sel = (sel + 1) % options.length;
      else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'h' || k === 'k') sel = (sel + options.length - 1) % options.length;
      else if (k === 'Enter') {
        const choice = options[clampSel(sel, options.length)]?.id;
        if (choice === 'rematch') flow.proposeRematch();
        else if (choice === 'accept') flow.acceptRematch();
        else if (choice === 'deny') flow.declineRematch();
        else if (choice === 'cancel') flow.cancelRematch();
        else if (choice === 'search') flow.searchAgain();
        else if (choice === 'menu') flow.backToMenu();
      }
    },
  };
}
