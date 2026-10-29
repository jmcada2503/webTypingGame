import type { Language, MatchKind } from '../flow/types';
import type { PaletteColor } from '../render/AsciiRenderer';

/** Placeholder until the real GitHub Sponsors page exists (the prototype used the repo owner's login). */
export const SPONSOR_LINK = 'https://github.com/sponsors/jmcada2503';
/** Placeholder game name. */
export const GAME_NAME: [string, string] = ['TYPING ', 'GAME'];

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Placeholder online counts: stale on purpose, they only change every 30 s. Replaced by the presence endpoint later. */
export function placeholderOnline(seconds: number) {
  const step = Math.floor(seconds / 30);
  const en = 97 + Math.round((hash(step) - 0.5) * 8);
  const es = 31 + Math.round((hash(step + 9) - 0.5) * 4);
  return { en, es, total: en + es };
}

export const MENU_ITEMS = [
  { key: 'practice', label: 'PRACTICE', desc: 'PLAY ALONE. WORDS KEEP COMING UNTIL YOU RUN OUT OF LIVES.', online: false },
  { key: 'public', label: 'PUBLIC MATCH', desc: 'FACE A RANDOM OPPONENT ONLINE.', online: true },
  { key: 'private', label: 'PRIVATE MATCH', desc: 'PLAY A FRIEND. YOU GET AN INVITE LINK TO SHARE.', online: true },
] as const;

/** The next menu card in direction `d`, wrapping around and skipping the online cards while servers rest. */
export function moveSelection(sel: number, d: 1 | -1, resting: boolean): number {
  const n = MENU_ITEMS.length;
  for (let k = 1; k <= n; k++) {
    const i = (sel + d * k + n * 4) % n;
    if (!(resting && MENU_ITEMS[i].online)) return i;
  }
  return sel;
}

/** The card that should be highlighted: an online card that became unavailable (servers resting) falls back to Practice. */
export function usableSelection(sel: number, resting: boolean): number {
  return resting && MENU_ITEMS[sel].online ? 0 : sel;
}

/** One line of the waiting screen's channel log: label, status, status color. Endless: it keeps scanning. */
export function waitingLogLine(i: number, kind: MatchKind, language: Language): [string, string, PaletteColor] {
  const lang = language === 'en' ? 'ENGLISH' : 'SPANISH';
  const base: [string, string, PaletteColor][] =
    kind === 'private'
      ? [
          ['OPENING CHANNEL', 'OK', 'green'],
          ['LANGUAGE', lang, 'fg'],
          ['CREATING PRIVATE MATCH', 'OK', 'green'],
          ['INVITE LINK', 'READY', 'green'],
          ['WAITING FOR GUEST', 'NO ONE YET', 'yellow'],
        ]
      : [
          ['OPENING CHANNEL', 'OK', 'green'],
          ['LANGUAGE', lang, 'fg'],
          ['ENTERING QUEUE', 'OK', 'green'],
          ['SCANNING SECTOR 07', 'NO CONTACT', 'yellow'],
        ];
  if (i < base.length) return base[i];
  const k = i - base.length;
  const label = kind === 'private' ? `PINGING GUEST SLOT ${k + 1}` : `SCANNING SECTOR ${String(7 + (((k + 1) * 5) % 40)).padStart(2, '0')}`;
  return [label, 'NO CONTACT', 'yellow'];
}

export const TIPS = [
  "TYPE A WORD BULLET'S WORD TO DESTROY IT BEFORE IT HITS YOU",
  'TYPE YOUR ATTACK WORD AND PRESS ENTER TO FIRE AT YOUR OPPONENT',
  'DEFENDING COMES FIRST: A MATCHING WORD BULLET IS DESTROYED BEFORE YOUR ATTACK FIRES',
  'YOU HAVE 3 LIVES. EVERY WORD BULLET THAT REACHES YOU COSTS ONE',
  'IF BOTH PLAYERS STAY IDLE FOR 10 SECONDS, THE MATCH ENDS IN PEACE',
];
const TIP_SECONDS = 6;
const TIP_LETTERS_PER_SECOND = 22;

/** The tip being typed out at `t` seconds: each tip shows for 6 s, then the next. */
export function typedTip(t: number): string {
  return TIPS[Math.floor(t / TIP_SECONDS) % TIPS.length].slice(0, Math.floor((t % TIP_SECONDS) * TIP_LETTERS_PER_SECOND));
}

export const DEMO_DEFEND_WORD = 'planet';
export const DEMO_ATTACK_WORD = 'rocket';

/** The how-to's looping 10 s demo: what is on screen `t` seconds in. */
export function howToDemo(t: number) {
  const tt = t % 10;
  return {
    bulletOn: tt < 4.6,
    flight: Math.min(0.85, tt / 5.4),
    defTyped: tt < 2.5 || tt >= 4.6 ? 0 : Math.min(6, Math.floor((tt - 2.5) / 0.3) + 1),
    boom: tt >= 4.6 && tt < 5.4 ? (tt - 4.6) / 0.8 : -1,
    atkTyped: tt < 5.6 || tt >= 7.4 ? 0 : Math.min(6, Math.floor((tt - 5.6) / 0.3) + 1),
    shotOn: tt >= 7.4 && tt < 9.2,
    shotFlight: (tt - 7.4) / 1.8,
    hit: tt >= 9.2 ? (tt - 9.2) / 0.8 : -1,
  };
}
