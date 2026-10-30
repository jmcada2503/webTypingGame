import type { ScreenFlow } from '../flow/ScreenFlow';
import type { TextGrid } from '../render/AsciiRenderer';
import { blink, box, centered, put, twoTone, wrap } from './draw';
import { GAME_NAME, MENU_ITEMS, SPONSOR_LINK, moveSelection, placeholderOnline, type OnlineCounts, usableSelection } from './content';
import type { Screen } from './Screen';

const ICONS: Record<(typeof MENU_ITEMS)[number]['key'], string[]> = {
  practice: ['  .---.  ', ' ( (+) ) ', "  '---'  "],
  public: [' /\\   /\\ ', '/__\\ /__\\', '   VS    '],
  private: ['  .---.  ', ' | LINK | ', "  '---'  "],
};
const COPIED_SECONDS = 1.6;

/** The approved main menu (layout B): three cards, language, online counts, a sponsor note or the resting panel. */
export function menuScreen(flow: ScreenFlow, copyText: (s: string) => void, onlineCounts: (t: number) => OnlineCounts = placeholderOnline): Screen {
  let sel = 0;
  let copiedAt = -99;
  /** Read from the flow, not from the drawn state: that one can lag a frame behind. */
  const restingNow = () => {
    const s = flow.state();
    return s.screen === 'menu' && s.serversResting;
  };
  const langName = () => (flow.language() === 'en' ? 'ENGLISH' : 'SPANISH');
  const copySponsor = (t: number) => {
    copiedAt = t;
    copyText(SPONSOR_LINK);
  };
  /** Menu time is the screen clock; remembered from the last draw so key presses can stamp "copied". */
  let now = 0;

  function restingPanel(text: TextGrid, c0: number, row: number, w: number, t: number) {
    const body = wrap('THE MONTHLY BUDGET THAT PAYS FOR THE ONLINE SERVERS IS USED UP, SO ONLINE MATCHES ARE PAUSED UNTIL IT RENEWS ON THE 1ST. PRACTICE STILL WORKS.', w - 6);
    const ask = wrap('WANT TO HELP KEEP THE GAME RUNNING? YOU CAN SUPPORT IT ON GITHUB SPONSORS:', w - 6);
    box(text, c0, row, w, body.length + ask.length + 6, 'red');
    put(text, c0 + 3, row, ' SERVERS RESTING ', 'red');
    body.forEach((l, i) => put(text, c0 + 3, row + 2 + i, l, 'fg'));
    ask.forEach((l, i) => put(text, c0 + 3, row + 3 + body.length + i, l, 'dim'));
    const r = row + 3 + body.length + ask.length;
    put(text, c0 + 3, r, SPONSOR_LINK, 'yellow');
    const copied = t - copiedAt < COPIED_SECONDS;
    put(text, c0 + w - 3 - 22, r + 1, copied ? 'COPIED!' : '[S] COPY SPONSOR LINK', copied ? 'green' : 'fg');
  }

  function sponsorNote(text: TextGrid, c0: number, row: number, w: number, t: number) {
    box(text, c0, row, w, 5, 'dim');
    put(text, c0 + 3, row + 1, 'WANT TO HELP KEEP THE GAME RUNNING?', 'fg');
    put(text, c0 + 3, row + 2, 'YOU CAN SUPPORT IT ON GITHUB SPONSORS:', 'dim');
    put(text, c0 + 3 + 40, row + 2, SPONSOR_LINK, 'yellow');
    const copied = t - copiedAt < COPIED_SECONDS;
    put(text, c0 + w - 3 - 17, row + 3, copied ? 'COPIED!' : '[S] COPY LINK', copied ? 'green' : 'dim');
  }

  return {
    draw(text, t, s) {
      if (s.screen !== 'menu') return;
      now = t;
      const resting = s.serversResting;
      sel = usableSelection(sel, resting);
      const online = onlineCounts(t);
      const mine = flow.language() === 'en' ? online.en : online.es;
      twoTone(text, 1.5, GAME_NAME[0], GAME_NAME[1], 2.8);
      centered(text, 6, 'TYPE FAST. DEFEND. ATTACK.', 'dim');
      const w = 36;
      MENU_ITEMS.forEach((it, i) => {
        const c0 = 6 + i * 40;
        const off = resting && it.online;
        const on = i === sel && !off;
        box(text, c0, 9, w, 20, on ? (blink(t, 3) ? 'yellow' : 'fg') : 'dim');
        text.writeScaled(c0 + (w - [...it.label].length * 1.4) / 2, 11, it.label, 1.4, off ? 'dim' : 'fg');
        ICONS[it.key].forEach((l, k) => put(text, c0 + (w - 9) / 2, 15 + k, l, off ? 'dim' : 'fg'));
        wrap(it.desc, 30).forEach((l, k) => put(text, c0 + 3, 20 + k, l, on ? 'fg' : 'dim'));
        if (off) put(text, c0 + (w - 7) / 2, 25, 'RESTING', 'red');
        else if (it.online) put(text, c0 + 3, 25, `${mine} ${langName()} PLAYERS ONLINE`, 'fg');
        else put(text, c0 + 3, 25, 'NO ONE ELSE NEEDED', 'fg');
        if (on) put(text, c0 + (w - 7) / 2, 27, '[ENTER]', 'yellow');
      });
      centered(text, 31, `[TAB] LANGUAGE:  <  ${langName()}  >      ONLINE NOW ${online.total}  (ENGLISH ${online.en}   SPANISH ${online.es})`, 'fg');
      if (resting) restingPanel(text, 19, 33, 90, t);
      else sponsorNote(text, 19, 34, 90, t);
      centered(text, 43, 'ARROWS OR H J K L CHOOSE   ENTER CONFIRM   TAB LANGUAGE   1-3 JUMP   S SPONSOR', 'dim');
    },
    onKey(e, s) {
      if (s.screen !== 'menu') return;
      const k = e.key;
      const resting = restingNow();
      if (k === 'Tab') flow.setLanguage(flow.language() === 'en' ? 'es' : 'en');
      else if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'l' || k === 'j') sel = moveSelection(sel, 1, resting);
      else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'h' || k === 'k') sel = moveSelection(sel, -1, resting);
      else if (k === 'Enter') flow.choose(MENU_ITEMS[sel].key);
      else if (k === '1' || k === '2' || k === '3') {
        const i = Number(k) - 1;
        if (!(resting && MENU_ITEMS[i].online)) sel = i;
        flow.choose(MENU_ITEMS[i].key);
      } else if (k === 's' || k === 'S') copySponsor(now);
    },
  };
}
