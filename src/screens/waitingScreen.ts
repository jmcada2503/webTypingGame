import type { ScreenFlow } from '../flow/ScreenFlow';
import type { TextGrid } from '../render/AsciiRenderer';
import { COLS, blink, box, centered, formatClock, put, twoTone } from './draw';
import { typedTip, waitingLogLine, placeholderOnline } from './content';
import type { Screen } from './Screen';

const COPIED_SECONDS = 1.6;
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** The approved waiting screen (terminal style C3): Public gets a long log, Private the Invite link panel. */
export function waitingScreen(flow: ScreenFlow, copyText: (s: string) => void): Screen {
  let copiedAt = -99;
  let now = 0;
  const langName = () => (flow.language() === 'en' ? 'ENGLISH' : 'SPANISH');

  function drawLog(text: TextGrid, c0: number, row: number, width: number, count: number, t: number, kind: 'public' | 'private') {
    const shown = Math.floor(t / 0.85) + 1;
    const n = Math.min(shown, count);
    const statusCol = c0 + width - 12;
    for (let k = 0; k < n; k++) {
      const i = shown > count ? shown - count + k : k;
      const [label, status, color] = waitingLogLine(i, kind, flow.language());
      put(text, c0, row + k, `> ${label} ${'.'.repeat(Math.max(2, statusCol - c0 - label.length - 4))}`, 'fg');
      put(text, statusCol, row + k, status, color);
    }
    if (blink(t)) put(text, c0, row + n, '> _', 'fg');
  }

  function invitePanel(text: TextGrid, row: number, link: string | undefined, t: number) {
    const w = 62;
    const c0 = Math.round((COLS - w) / 2);
    box(text, c0, row, w, 5, 'fg');
    put(text, c0 + 3, row + 1, 'INVITE LINK', 'dim');
    put(text, c0 + 3, row + 2, link ?? 'CREATING YOUR INVITE LINK...', 'yellow');
    const copied = t - copiedAt < COPIED_SECONDS;
    put(text, c0 + w - 20, row + 3, copied ? 'COPIED!' : '[C] COPY LINK', copied ? 'green' : 'fg');
  }

  return {
    draw(text, t, s) {
      if (s.screen !== 'waiting') return;
      now = t;
      const priv = s.kind === 'private';
      const [a, b] = priv ? (['WAITING FOR ', 'YOUR FRIEND'] as const) : (['FINDING A ', 'RANDOM OPPONENT'] as const);
      const ticker = (row: number, dir: number) => {
        const unit = `${priv ? 'WAITING FOR YOUR FRIEND' : 'FINDING A RANDOM OPPONENT'}   ///   `;
        const strip = unit.repeat(Math.ceil(COLS / unit.length) + 2);
        const shift = Math.floor(t * 10 * dir);
        put(text, 0, row, strip.slice(((shift % unit.length) + unit.length) % unit.length).slice(0, COLS), 'yellow');
      };
      ticker(1, 1);
      ticker(43, -1);
      box(text, 14, 5, 100, 9, 'fg');
      twoTone(text, 7, a, b, 2.6);
      const subtitle = s.phase === 'connecting' ? 'OPPONENT FOUND! CONNECTING...' : priv ? 'SEND THEM THE LINK BELOW. THE MATCH STARTS WHEN THEY JOIN.' : 'THE MATCH STARTS AS SOON AS ANOTHER PLAYER IS LOOKING TOO.';
      centered(text, 11.5, subtitle, s.phase === 'connecting' ? 'green' : 'dim');
      put(text, 14, 17, 'TIP', 'yellow');
      put(text, 18, 17, typedTip(t) + (blink(t) ? '_' : ' '), 'fg');
      const o = placeholderOnline(t);
      put(text, 14, 20, 'ONLINE NOW', 'dim');
      put(text, 26, 20, `${o.total}     ENGLISH ${o.en}   SPANISH ${o.es}`, 'fg');
      drawLog(text, 14, 23, 100, priv ? 3 : 10, t, s.kind);
      if (priv) invitePanel(text, 29, s.inviteLink, t);
      else {
        const sig = 0.18 + 0.2 * (0.5 + 0.5 * Math.sin(t * 1.3)) + 0.1 * hash(Math.floor(t * 6));
        const n = Math.round(sig * 60);
        put(text, 14, 35, `SIGNAL [${'#'.repeat(n)}${'-'.repeat(60 - n)}]`, 'dim');
      }
      centered(text, priv ? 36 : 38, `ELAPSED ${formatClock(t)}`, 'fg');
      centered(text, priv ? 38 : 40, `LANGUAGE: ${langName()}        [Q] CANCEL`, 'dim');
    },
    onKey(e, s) {
      if (s.screen !== 'waiting') return;
      if (e.key === 'q' || e.key === 'Q') flow.cancel();
      else if ((e.key === 'c' || e.key === 'C') && s.kind === 'private' && s.inviteLink) {
        copiedAt = now;
        copyText(s.inviteLink);
      }
    },
  };
}
