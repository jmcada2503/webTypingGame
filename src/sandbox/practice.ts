// Dev page: the real Practice mode on the real render layer, with a plain text result when it ends.
// The real menu / result screens come later; this only lets you play the ramp.
import '../app/app.css';
import { AppShell } from '../app/AppShell';
import { KeyboardTypingInput } from '../input/KeyboardTypingInput';
import { createPracticeSession, type PracticeResult } from '../practice/PracticeSession';
import { AsciiGameView } from '../view/AsciiGameView';
import { LANGUAGES, type Language } from '../words/wordLists';

const asked = new URLSearchParams(location.search).get('lang');
const language: Language = LANGUAGES.find((l) => l === asked) ?? 'en';

const session = await createPracticeSession(language);
const shell = new AppShell(await AsciiGameView.create(), session, new KeyboardTypingInput());
shell.start();
if (import.meta.env.DEV) Object.assign(window, { practice: session });

const box = document.createElement('pre');
box.style.cssText = 'position:fixed;top:12px;left:12px;margin:0;color:#9f9;font:14px/1.4 monospace;white-space:pre;pointer-events:none';
document.body.append(box);

const pct = (x: number | null) => (x === null ? '-' : `${Math.round(x * 100)}%`);
const show = (r: PracticeResult, done: boolean) =>
  (box.textContent = [
    done ? 'GAME OVER' : `PRACTICE (${language})`,
    `time      ${r.survivedSeconds.toFixed(1)} s (${r.activeSeconds.toFixed(1)} s with words on screen)`,
    `words     ${r.wordsTyped}`,
    `accuracy  ${pct(r.accuracy)}`,
    `pace      ${r.averagePace.toFixed(1)} letters/s avg, ${r.peakPace.toFixed(1)} peak (${Math.round(r.wpm)} wpm)`,
    r.startLevel === null
      ? 'level     measuring your speed...'
      : `level     started at ${r.startLevel} s of the ramp (measured ${(r.calibrationPace ?? 0).toFixed(1)} letters/s)`,
    done ? 'reload to play again' : '',
  ].join('\n'));

setInterval(() => show(session.result(), session.status === 'lost'), 250);
