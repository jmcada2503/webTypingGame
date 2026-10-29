import type { ScreenFlow } from '../flow/ScreenFlow';
import type { TextGrid } from '../render/AsciiRenderer';
import type { PracticeResult } from '../practice/PracticeSession';
import { practiceResultLines, practiceScore } from './content';
import { blink, centered, formatClock, twoTone } from './draw';
import { onlineEndScreen, type OnlineStats } from './endScreens';
import type { Screen, ScreenSet } from './Screen';

/**
 * Plain, readable versions of every screen so the whole flow can be walked end to end. Screens that have an
 * approved design (menu, how-to, waiting, Countdown) get replaced by the real ones; the end, Opponent-left and
 * error screens stay like this until their prototypes are done.
 */
const lines = (text: TextGrid, start: number, rows: string[], color: 'fg' | 'dim' = 'fg') => rows.forEach((r, i) => centered(text, start + i, r, color));

export function simpleScreens(flow: ScreenFlow, practiceResult: () => PracticeResult | null = () => null, onlineStats: () => OnlineStats | null = () => null): ScreenSet {
  const menu: Screen = {
    draw(text, t, s) {
      if (s.screen !== 'menu') return;
      twoTone(text, 3, 'TYPING ', 'GAME', 3);
      lines(text, 14, ['[1] PRACTICE', '[2] PUBLIC MATCH', '[3] PRIVATE MATCH']);
      centered(text, 22, `[TAB] LANGUAGE: ${s.language === 'en' ? 'ENGLISH' : 'SPANISH'}`, 'dim');
      if (s.serversResting) centered(text, 26, 'SERVERS RESTING: ONLINE MATCHES ARE PAUSED', 'fg');
      void t;
    },
    onKey(e, s) {
      if (s.screen !== 'menu') return;
      if (e.key === '1') flow.choose('practice');
      if (e.key === '2') flow.choose('public');
      if (e.key === '3') flow.choose('private');
      if (e.key === 'Tab') flow.setLanguage(s.language === 'en' ? 'es' : 'en');
    },
  };

  const howto: Screen = {
    draw(text, t, s) {
      if (s.screen !== 'howto') return;
      twoTone(text, 4, 'HOW TO ', 'PLAY', 3);
      lines(text, 14, ['DEFEND: TYPE THE WORD FLYING AT YOU, THEN PRESS ENTER', 'ATTACK: TYPE YOUR RED WORD, THEN PRESS ENTER']);
      centered(text, 22, `AUTO-START IN ${Math.ceil(s.secondsLeft)}S`, 'dim');
      centered(text, 25, blink(t, 1.5) ? '[ENTER] START NOW' : '', 'yellow');
    },
    onKey(e) {
      if (e.key === 'Enter') flow.confirm();
    },
  };

  const waiting: Screen = {
    draw(text, t, s) {
      if (s.screen !== 'waiting') return;
      twoTone(text, 4, s.kind === 'public' ? 'FINDING A ' : 'WAITING FOR ', s.kind === 'public' ? 'RANDOM OPPONENT' : 'YOUR FRIEND', 2.6);
      centered(text, 14, s.phase === 'connecting' ? 'CONNECTING...' : 'SEARCHING...', 'fg');
      if (s.inviteLink) centered(text, 17, s.inviteLink, 'yellow');
      centered(text, 22, `ELAPSED ${formatClock(t)}        [Q] CANCEL`, 'dim');
    },
    onKey(e) {
      if (e.key === 'q' || e.key === 'Q') flow.cancel();
    },
  };

  const countdown: Screen = {
    draw(text, _t, s) {
      if (s.screen !== 'countdown') return;
      const n = Math.max(1, Math.ceil(s.secondsLeft));
      const digit = String(n);
      text.writeScaled((128 - digit.length * 9) / 2, 12, digit, 9, n <= 2 ? 'red' : 'yellow');
      centered(text, 6, 'MATCH STARTS IN', 'fg');
    },
  };

  const match: Screen = { draw() {} }; // the Match is the game scene itself

  const onlineEnd = onlineEndScreen(flow, onlineStats);
  const end: Screen = {
    draw(text, t, s) {
      if (s.screen !== 'end') return;
      if (s.mode === 'practice') {
        twoTone(text, 6, 'GAME ', 'OVER', 3);
        const result = practiceResult();
        if (result) {
          // One left-aligned block, centered as a whole, so the numbers line up.
          const score = `SCORE ${practiceScore(result)}`;
          text.writeScaled((128 - score.length * 3) / 2, 11.5, score, 3, 'yellow');
          const rows = practiceResultLines(result);
          const col = (128 - Math.max(...rows.map((l) => l.length))) / 2;
          rows.forEach((l, i) => text.write(Math.round(col), 17 + i, l, 'fg'));
        }
        lines(text, 25, ['[ENTER] PLAY AGAIN', '[Q] MENU']);
        return;
      }
      onlineEnd.draw(text, t, s);
    },
    onKey(e, s) {
      if (s.screen !== 'end') return;
      const k = e.key.toLowerCase();
      if (s.mode === 'practice') {
        if (k === 'enter') flow.playAgain();
      } else return onlineEnd.onKey(e, s);
      if (k === 'q') flow.backToMenu();
    },
  };

  const opponentLeft: Screen = {
    draw(text, _t, s) {
      if (s.screen !== 'opponentLeft') return;
      twoTone(text, 6, 'OPPONENT ', 'LEFT', 3);
      if (s.youWin) centered(text, 16, 'YOU WIN', 'green');
      lines(text, 20, [s.kind === 'public' ? '[S] SEARCH FOR A NEW OPPONENT' : '', '[Q] MENU'], 'dim');
    },
    onKey(e) {
      const k = e.key.toLowerCase();
      if (k === 's') flow.searchAgain();
      if (k === 'q') flow.backToMenu();
    },
  };

  const error: Screen = {
    draw(text, _t, s) {
      if (s.screen !== 'error') return;
      const message = { connectFailed: "COULDN'T CONNECT TO THE OTHER PLAYER", inviteFull: 'THIS MATCH IS FULL', inviteExpired: 'THIS INVITE LINK HAS EXPIRED' }[s.reason];
      twoTone(text, 6, 'COULD NOT ', 'JOIN', 3);
      centered(text, 16, message, 'fg');
      lines(text, 20, [s.reason === 'connectFailed' && s.kind === 'public' ? '[S] SEARCH AGAIN' : '', '[Q] MENU'], 'dim');
    },
    onKey(e) {
      const k = e.key.toLowerCase();
      if (k === 's') flow.searchAgain();
      if (k === 'q') flow.backToMenu();
    },
  };

  return { menu, howto, waiting, countdown, match, end, opponentLeft, error };
}

