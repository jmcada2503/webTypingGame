// PROTOTYPE (throwaway): "Prototype: Disconnect animation and Opponent-left screen".
// Question: what should the player see (1) while the opponent's connection is down in a Match (10 s grace),
// and (2) on the "Opponent left" screen afterwards?   Real renderer + CRT filter, stub opponent, no networking.
//
// Keys:  D  opponent's connection drops (10 s grace, then the win + Opponent left screen; the 3rd drop skips the grace)
//        X  opponent comes back during the grace (words reappear, 5 s countdown)      R  reset to a running Match
//        1-4 disconnect animation A-D                 [ ]  Opponent-left layout 1-3
//        C  where it happened (waiting / countdown / match)      P  Public / Private
//        O  jump straight to the Opponent-left screen   W  show/hide held words   hjkl or arrows + Enter  pick an option
import * as THREE from 'three';
import '../../app/app.css';
import { AppShell } from '../../app/AppShell';
import type { GameSession, SessionStatus } from '../../app/GameSession';
import { KeyboardTypingInput } from '../../input/KeyboardTypingInput';
import type { PaletteColor, TextGrid } from '../../render/AsciiRenderer';
import type { GpuAsciiRenderer } from '../../render/GpuAsciiRenderer';
import { AsciiGameView } from '../../view/AsciiGameView';
import type { GameViewState, ViewEvent } from '../../view/GameViewState';

const COLS = 128;
const GRACE = 10; // seconds the opponent has to come back
const params = new URLSearchParams(location.search);

type Phase = 'match' | 'lost' | 'back' | 'win' | 'left';
const BACK_BEAT = 0.8; // the words reappear this long before the countdown starts
const BACK_COUNT = 5; // seconds of countdown over the game once the opponent is back
const WIN_STUB = 2.6; // placeholder for the win animation (its own prototype ticket)
const MAX_DROPS = 3; // the 3rd signal loss in a Match: no reconnect time, the opponent is considered gone
let drops = 0;
let reason: 'timeout' | 'unstable' = 'timeout';
type Where = 'waiting' | 'countdown' | 'match';
const ANIMS = [
  { key: 'A', name: 'Signal breakup (static eats the ship)' },
  { key: 'B', name: 'Dead feed (the ship becomes a NO SIGNAL monitor)' },
  { key: 'C', name: 'Countdown takeover (space freezes, big 5..1)' },
  { key: 'D', name: 'Radar search (ship vanishes, rings sweep out)' },
];
const WHERES: Where[] = ['waiting', 'countdown', 'match'];
let phase: Phase = params.get('phase') === 'left' ? 'left' : 'match';
let anim = Math.max(0, 'ABCD'.indexOf(params.get('anim') ?? 'A'));
let layout = Math.min(2, Math.max(0, Number(params.get('layout') ?? 1) - 1));
let where: Where = (WHERES.find((w) => w === params.get('where')) ?? 'match') as Where;
let kind: 'public' | 'private' = params.get('kind') === 'private' ? 'private' : 'public';
let sel = 0;
let hideWords = true; // the opponent's held Word bullets are hidden while they are away (W toggles)
let toast: { msg: string; at: number } | null = null;

const t0 = performance.now();
const clock = () => (performance.now() - t0) / 1000;
let phaseStart = clock();
const freezeT = params.get('t') !== null ? Number(params.get('t')) : null; // ?t=2.5 freezes the phase clock for stills
const phaseT = () => freezeT ?? clock() - phaseStart;
const setPhase = (p: Phase) => {
  phase = p;
  phaseStart = clock();
  sel = 0;
  session.setFrozen(p === 'lost' || p === 'back'); // held while the opponent is away and during the countdown
};

// ---------------------------------------------------------------- stub opponent + game

class ProtoSession implements GameSession {
  status: SessionStatus = 'running';
  pace = { player: 1, enemy: 1 };
  private bullets: { id: string; word: string; flight: number }[] = [];
  private events: ViewEvent[] = [];
  private n = 0;
  private nextAt = 1;
  private frozen = false;
  start() {}
  dispose() {}
  attachInput() {}
  setFrozen(f: boolean) {
    this.frozen = f;
  }
  update(dt: number): ViewEvent[] {
    if (!this.frozen) {
      for (const b of this.bullets) b.flight += dt / 9;
      for (const b of [...this.bullets]) {
        if (b.flight >= 1) {
          this.events.push({ type: 'wordBulletArrived', id: b.id });
          this.bullets.splice(this.bullets.indexOf(b), 1);
        }
      }
      this.nextAt -= dt;
      if (this.nextAt <= 0 && phase !== 'left') {
        const words = ['planet', 'comet', 'orbit', 'signal', 'engine', 'galaxy'];
        const id = `w${this.n++}`;
        this.bullets.push({ id, word: words[this.n % words.length], flight: 0 });
        this.events.push({ type: 'enemyFired', id });
        this.nextAt = 2.4;
      }
    }
    const ev = this.events;
    this.events = [];
    return ev;
  }
  state(): GameViewState {
    return { lives: 3, typedWord: '', attackWord: 'rocket', wordBullets: this.bullets.map((b) => ({ ...b })), shots: [], enemyDamage: 0, pace: this.pace };
  }
}
const session = new ProtoSession();
const input = new KeyboardTypingInput();
input.setEnabled(false);
const view = await AsciiGameView.create();
const hidden = view as unknown as { ascii: GpuAsciiRenderer; scene: THREE.Scene; overlay: THREE.Scene; enemy: { root: THREE.Group } };
const text: TextGrid = hidden.ascii.textGrid;
const asciiRender = hidden.ascii.render.bind(hidden.ascii);
hidden.ascii.render = (scene, camera, overlay) => {
  const world = phase !== 'left';
  hidden.scene.visible = world;
  hidden.overlay.visible = world && !((phase === 'lost' && hideWords) || phase === 'win');
  if (!world) text.clear();
  else text.fill(7, 1, 30, 3, ' '); // hide the game view's dim debug event label
  const t = phaseT();
  hidden.enemy.root.visible = true;
  session.pace = { player: 1, enemy: 1 };
  if (phase === 'lost') drawLost(t);
  else if (phase === 'back') drawBack(t);
  else if (phase === 'win') drawWin(t);
  else if (phase === 'left') drawLeft(t);
  if (phase === 'lost' && t >= GRACE) endMatch('timeout');
  if (phase === 'back' && t >= BACK_BEAT + BACK_COUNT) setPhase('match'); // the Match resumes
  if (phase === 'win' && t >= WIN_STUB) setPhase('left');
  if (toast && clock() - toast.at < 2.4) centered(0.3, toast.msg, 'green');
  hint();
  asciiRender(scene, camera, overlay);
};
new AppShell(view, session, input).start();

// ---------------------------------------------------------------- helpers

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const put = (c: number, r: number, s: string, col?: PaletteColor) => text.write(Math.round(c), Math.round(r), s, col);
const centered = (r: number, s: string, col?: PaletteColor) => put((COLS - [...s].length) / 2, r, s, col);
const blink = (t: number, hz = 2) => Math.floor(t * hz) % 2 === 0;
const say = (msg: string) => (toast = { msg, at: clock() });
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

function box(c0: number, r0: number, w: number, h: number, color: PaletteColor = 'dim') {
  text.fill(c0, r0, w, h, ' ');
  put(c0, r0, '+' + '-'.repeat(w - 2) + '+', color);
  put(c0, r0 + h - 1, '+' + '-'.repeat(w - 2) + '+', color);
  for (let r = r0 + 1; r < r0 + h - 1; r++) {
    put(c0, r, '|', color);
    put(c0 + w - 1, r, '|', color);
  }
}
function wrap(s: string, w: number) {
  const out: string[] = [];
  let line = '';
  for (const word of s.split(' ')) {
    if ((line + ' ' + word).trim().length > w) {
      out.push(line);
      line = word;
    } else line = (line + ' ' + word).trim();
  }
  if (line) out.push(line);
  return out;
}
function bar(c0: number, row: number, w: number, frac: number, color: PaletteColor) {
  const n = Math.round(w * clamp01(frac));
  put(c0, row, '[' + '#'.repeat(n) + '-'.repeat(w - n) + ']', color);
}
/** Big number, with RGB-split ghosts for the first moments of each second. */
function bigNumber(s: string, scale: number, row: number, color: PaletteColor, frac: number) {
  const c = (COLS - [...s].length * scale) / 2;
  if (frac < 0.14) {
    text.writeScaled(c - 1.2, row, s, scale, 'red');
    text.writeScaled(c + 1.2, row, s, scale, 'green');
  }
  text.writeScaled(c, row, s, scale, color);
}

// ---------------------------------------------------------------- while the connection is down 

/** Roughly where the Enemy ship is on the grid (it bobs a little). */
const SHIP = { c: 40, r: 3, w: 48, h: 14 };
const STATIC = '.:;\'`*#%@+=~';

function staticField(c0: number, r0: number, w: number, h: number, density: number, t: number, color: PaletteColor = 'fg') {
  const frame = Math.floor(t * 18);
  for (let r = r0; r < r0 + h; r++) {
    const slip = hash(r * 7 + frame) > 0.93 ? Math.round((hash(r + frame * 3) - 0.5) * 10) : 0; // jumping rows
    for (let c = c0; c < c0 + w; c++) {
      if (hash(c * 131 + r * 17 + frame * 7) < density) {
        put(c + slip, r, STATIC[Math.floor(hash(c * 3 + r * 5 + frame) * STATIC.length)], hash(c + r * 9 + frame * 2) > 0.8 ? 'dim' : color);
      }
    }
  }
}

function drawLost(t: number) {
  const left = Math.max(0, GRACE - t);
  const secs = Math.ceil(left);
  const frac = (t * 1) % 1;
  // The opponent's Word bullets are held in flight while they are away (they cannot hurt you).
  if (anim === 0) animBreakup(t, left);
  else if (anim === 1) animDeadFeed(t, left);
  else if (anim === 2) animTakeover(t, left, secs, frac);
  else animRadar(t, left);
  // After the 2nd loss, warn: one more and there is no reconnect time at all.
  if (drops >= MAX_DROPS - 1) centered(20.2, blink(t, 1.5) ? `SIGNAL LOSS ${drops} OF ${MAX_DROPS}: ONE MORE AND THE OPPONENT IS CONSIDERED GONE` : '', 'red');
  else if (drops > 0) centered(20.2, `SIGNAL LOSS ${drops} OF ${MAX_DROPS}`, 'dim');
}

/** A: the ship's picture falls apart into static that spreads until it cuts out. */
function animBreakup(t: number, left: number) {
  const k = clamp01(t / GRACE);
  hidden.enemy.root.visible = hash(Math.floor(t * 14)) > k * 0.55 && t < GRACE - 0.2; // flickers more and more, then gone
  staticField(SHIP.c - 4, SHIP.r - 1, SHIP.w + 8, SHIP.h + 2, 0.05 + 0.55 * k ** 1.3, t);
  centered(1.2, blink(t, 3) ? '!!  ENEMY SIGNAL LOST  !!' : '    ENEMY SIGNAL LOST    ', 'red');
  put(44, 17, 'RECONNECTING', 'yellow');
  bar(58, 17, 24, left / GRACE, 'yellow');
  put(84, 17, `${left.toFixed(1)} s`, 'fg');
  centered(18.5, 'THEIR WORD BULLETS ARE HELD IN FLIGHT. NOTHING CAN HIT YOU.', 'dim');
}

/** B: the ship is replaced by a dead monitor showing a "no signal" test pattern. */
function animDeadFeed(t: number, left: number) {
  const cut = t > 0.35;
  hidden.enemy.root.visible = !cut || hash(Math.floor(t * 20)) > 0.7; // brief flicker as the feed dies
  if (!cut) return staticField(SHIP.c, SHIP.r, SHIP.w, SHIP.h, 0.4, t);
  const c0 = 42;
  const r0 = 2;
  const w = 44;
  const h = 15;
  box(c0, r0, w, h, 'dim');
  const bars: PaletteColor[] = ['fg', 'yellow', 'green', 'red', 'dim'];
  const shift = Math.floor(t * 6);
  for (let r = r0 + 1; r < r0 + h - 5; r++) {
    for (let c = c0 + 1; c < c0 + w - 1; c++) {
      const col = bars[(Math.floor((c - c0) / 6) + shift) % bars.length];
      put(c, r, (r + c + shift) % 2 ? '|' : ':', col);
    }
  }
  text.fill(c0 + 7, r0 + h - 6, w - 14, 5, ' ');
  text.writeScaled(c0 + 8, r0 + h - 6, 'NO SIGNAL', 2.2, blink(t, 1.5) ? 'red' : 'dim');
  put(c0 + 4, r0 + h - 2, `CHANNEL: ENEMY   RETRYING ${'.'.repeat(1 + (Math.floor(t * 3) % 3))}`, 'fg');
  put(54, 18, 'GIVING UP IN', 'yellow');
  put(67, 18, `${left.toFixed(1)} s`, 'fg');
  bar(46, 19, 36, left / GRACE, 'yellow');
}

/** C: space itself freezes; a big countdown takes over the middle of the screen. */
function animTakeover(t: number, left: number, secs: number, frac: number) {
  session.pace = { player: Math.max(0, 1 - t * 2), enemy: 0 }; // the stars slow to a halt
  hidden.enemy.root.visible = true;
  centered(19.5, 'CONNECTION LOST', 'red');
  text.fill(0, 21, COLS, 11, ' ');
  bigNumber(String(Math.max(1, secs)), 9 - 1.4 * frac, 22, secs <= 2 ? 'red' : 'yellow', frac);
  centered(33, 'THE OTHER PLAYER HAS A FEW SECONDS TO COME BACK', 'dim');
  centered(34.5, blink(t, 2) ? 'OTHERWISE YOU WIN' : '', 'fg');
  void left;
}

/** D: the ship pops out of existence and radar rings sweep from where it was while we search for it. */
function animRadar(t: number, left: number) {
  const pop = 0.45;
  hidden.enemy.root.visible = t < pop && hash(Math.floor(t * 24)) > 0.35;
  session.pace = { player: 0.15, enemy: 0.05 };
  const cx = SHIP.c + SHIP.w / 2;
  const cy = SHIP.r + SHIP.h / 2;
  for (let ring = 0; ring < 3; ring++) {
    const u = ((t * 0.7 - ring / 3) % 1 + 1) % 1; // each ring is 1/3 of a cycle behind the last
    const rad = u * 26;
    const color: PaletteColor = u < 0.5 ? 'green' : 'dim';
    for (let a = 0; a < 72; a++) {
      const ang = (a / 72) * Math.PI * 2;
      put(cx + Math.cos(ang) * rad * 2, cy + Math.sin(ang) * rad * 0.55, '.', color);
    }
  }
  put(cx - 0.5, cy, blink(t, 3) ? '?' : ' ', 'yellow');
  centered(18.2, `SEARCHING FOR SIGNAL${'.'.repeat(Math.floor(t * 2.5) % 4)}`, 'green');
  put(44, 19.7, 'NO REPLY. WAITING', 'dim');
  bar(63, 19.7, 20, left / GRACE, 'green');
  put(85, 19.7, `${left.toFixed(1)} s`, 'fg');
}

/**
 * The opponent is back. Their held Word bullets are on screen again at once (the player sees where they stand),
 * and after a short beat a 5 s countdown runs over the game. The "enemy is back" message lives with the countdown
 * (the words can cover anything drawn elsewhere). The Match resumes when it ends.
 */
function drawBack(t: number) {
  staticField(SHIP.c, SHIP.r, SHIP.w, SHIP.h, Math.max(0, 0.45 - t * 1.2), t);
  centered(17.2, blink(t, 4) ? 'ENEMY IS BACK' : '', 'green');
  if (t < BACK_BEAT) return centered(19, 'CHECK YOUR WORDS', 'dim');
  const c = t - BACK_BEAT;
  const n = Math.max(1, Math.ceil(BACK_COUNT - c));
  const frac = c % 1;
  text.fill(0, 19, COLS, 12, ' ');
  centered(19.2, 'THE MATCH RESUMES IN', 'fg');
  bigNumber(String(n), 9 - 1.4 * frac, 21, n <= 2 ? 'red' : 'yellow', frac);
  centered(32, 'THEIR WORDS ARE STILL HELD. NOTHING MOVES UNTIL THE COUNTDOWN ENDS.', 'dim');
}

/** Placeholder: the real win animation is designed in its own prototype ticket. It also plays after a disconnect. */
function drawWin(t: number) {
  hidden.enemy.root.visible = false;
  if (blink(t, 8) || t > 1.2) centered(15, 'YOU WIN', 'green');
  text.writeScaled((COLS - 7 * 6) / 2, 17, 'YOU WIN', 6, blink(t, 6) ? 'green' : 'fg');
  centered(28, '[ WIN ANIMATION PLACEHOLDER: SAME ONE AS A NORMAL WIN ]', 'dim');
  centered(30, reason === 'unstable' ? 'THE OPPONENT CONNECTION KEPT DROPPING' : 'THE OPPONENT DID NOT COME BACK', 'dim');
}

/** The Match ends because of the opponent's connection: the win animation first, then the Opponent left screen. */
function endMatch(why: 'timeout' | 'unstable') {
  reason = why;
  where = 'match';
  setPhase('win');
}

/** The opponent's signal drops. The third time there is no reconnect time at all. */
function dropSignal() {
  where = 'match';
  drops++;
  if (drops >= MAX_DROPS) {
    say('THIRD SIGNAL LOSS: NO RECONNECT TIME');
    return endMatch('unstable');
  }
  setPhase('lost');
}

// ---------------------------------------------------------------- the "Opponent left" screen

const SUB: Record<Where, string> = {
  waiting: 'THE OTHER PLAYER LEFT BEFORE THE MATCH COULD START.',
  countdown: 'THE OTHER PLAYER LEFT DURING THE COUNTDOWN. THE MATCH NEVER STARTED.',
  match: 'THE OTHER PLAYER LEFT THE MATCH AND DID NOT COME BACK IN 10 SECONDS.',
};
/** The message under the title; a Match that ended because the connection kept dropping says so. */
const subText = () => (where === 'match' && reason === 'unstable' ? "THE OTHER PLAYER'S CONNECTION KEPT DROPPING, SO THE MATCH WAS ENDED." : SUB[where]);
const WHEN: Record<Where, string> = { waiting: 'BEFORE THE MATCH', countdown: 'DURING THE COUNTDOWN', match: 'DURING THE MATCH' };
const wins = () => where === 'match';
const options = () => (kind === 'public' ? ['SEARCH AGAIN', 'MENU'] : ['MENU']);

function optionsRow(row: number, mode: 'row' | 'column', c0 = 0) {
  const opts = options();
  const blinkOn = blink(phaseT(), 3);
  opts.forEach((label, i) => {
    const on = i === sel;
    const text1 = on ? `> ${label} <` : `  ${label}  `;
    const col: PaletteColor = on ? (blinkOn ? 'yellow' : 'fg') : 'dim';
    if (mode === 'row') put(COLS / 2 - 22 + i * 26, row, text1, col);
    else put(c0, row + i * 2, text1, col);
  });
}

function drawLeft(t: number) {
  [layoutTerminal, layoutBanner, layoutLog][layout](t);
  put(2, 43, `PROTOTYPE  ANIM ${ANIMS[anim].key}  LAYOUT ${layout + 1}  ${where.toUpperCase()}  ${kind.toUpperCase()}`, 'dim');
}

/** 1: a framed terminal message in the middle of the screen. */
function layoutTerminal(t: number) {
  const w = 76;
  const c0 = (COLS - w) / 2;
  const sub = wrap(subText(), w - 10);
  const h = 11 + sub.length + (wins() ? 3 : 0);
  const r0 = Math.round((45 - h) / 2) - 2;
  box(c0, r0, w, h, wins() ? 'green' : 'yellow');
  put(c0 + 3, r0, ' OPPONENT LEFT ', 'yellow');
  put(c0 + w - 20, r0, ' CHANNEL CLOSED ', 'dim');
  sub.forEach((l, i) => put(c0 + 5, r0 + 3 + i, l, 'fg'));
  let r = r0 + 4 + sub.length;
  if (wins()) {
    put(c0 + 5, r, blink(t, 2) ? '>>  YOU WIN  <<' : '                ', 'green');
    put(c0 + 5, r + 1, 'THE MATCH ENDS HERE. THE RESULT COUNTS AS A WIN FOR YOU.', 'dim');
    r += 3;
  } else {
    put(c0 + 5, r, 'NO RESULT: NOBODY WON OR LOST.', 'dim');
    r += 2;
  }
  optionsRow(r + 1, 'column', c0 + 5);
  put(c0 + w - 36, r0 + h - 2, 'ARROWS CHOOSE   ENTER CONFIRM', 'dim');
}

/** 2: a big two-tone title like the menu, with the options as a row of buttons. */
function layoutBanner(t: number) {
  const a = 'OPPONENT ';
  const b = 'LEFT';
  const scale = 2.8;
  const c = (COLS - ([...a].length + [...b].length) * scale) / 2;
  if (wins()) centered(5, blink(t, 2) ? 'YOU WIN' : '       ', 'green');
  text.writeScaled(c, 8, a, scale, 'fg');
  text.writeScaled(c + [...a].length * scale, 8, b, scale, 'yellow');
  const sub = wrap(subText(), 70);
  sub.forEach((l, i) => centered(17 + i, l, 'fg'));
  centered(19 + sub.length, wins() ? 'THE RESULT COUNTS AS A WIN FOR YOU.' : 'NO RESULT: NOBODY WON OR LOST.', 'dim');
  optionsRow(26, 'row');
  centered(30, 'ARROWS CHOOSE   ENTER CONFIRM', 'dim');
  for (let i = 0; i < 128; i++) put(i, 33, hash(i + Math.floor(t * 4)) > 0.5 ? '.' : ' ', 'dim'); // a dead scan line
}

const DEAD_SHIP = ['       /\\       ', '      /  \\      ', '   __/ xx \\__   ', '  /__  ~~  __\\  ', '     \\ ~~ /     ', '      \\  /      ', '       \\/       '];

/** 3: split screen: the dead ship on the left, a connection log on the right. */
function layoutLog(t: number) {
  box(8, 6, 50, 26, 'dim');
  put(11, 6, ' LAST KNOWN SIGNAL ', 'dim');
  staticField(10, 8, 46, 22, 0.1, t, 'dim');
  DEAD_SHIP.forEach((l, i) => put(24, 14 + i, l, 'fg'));
  centered(32.5, '', 'dim');
  put(16, 30, '~ ~ ~  NO CARRIER  ~ ~ ~', blink(t, 1.5) ? 'red' : 'dim');
  const c0 = 64;
  put(c0, 6, 'CONNECTION LOG', 'yellow');
  const log: [string, PaletteColor][] = [
    ['> CHANNEL TO OPPONENT CLOSED', 'fg'],
    [`> WHEN: ${WHEN[where]}`, 'fg'],
    [where !== 'match' ? '> GRACE PERIOD: NOT NEEDED' : reason === 'unstable' ? `> SIGNAL LOST ${MAX_DROPS} TIMES: NO GRACE` : '> GRACE PERIOD: 10 S, NO REPLY', 'dim'],
    [wins() ? '> RESULT: YOU WIN' : '> RESULT: NONE', wins() ? 'green' : 'dim'],
    [kind === 'public' ? '> MODE: PUBLIC MATCH' : '> MODE: PRIVATE MATCH', 'dim'],
  ];
  log.forEach(([l, col], i) => put(c0, 9 + i * 2, l, col));
  wrap(subText(), 54).forEach((l, i) => put(c0, 21 + i, l, 'fg'));
  optionsRow(27, 'column', c0);
  put(c0, 33, 'ARROWS CHOOSE   ENTER CONFIRM', 'dim');
}

// ---------------------------------------------------------------- keys + hint

function hint() {
  if (phase === 'left') return;
  put(2, 43, `PROTOTYPE  ANIM ${ANIMS[anim].key}: ${ANIMS[anim].name}   D drop (${drops}/${MAX_DROPS})  X opponent back  R reset  1-4 anim  O left screen  W words`, 'dim');
}

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if ('1234'.includes(k) && k.length === 1) {
    anim = Number(k) - 1;
    return say(`ANIMATION ${ANIMS[anim].key}: ${ANIMS[anim].name.toUpperCase()}`);
  }
  if (k === '[' || k === ']') {
    layout = (layout + (k === ']' ? 1 : 2)) % 3;
    return say(`LAYOUT ${layout + 1}`);
  }
  if (k === 'c' || k === 'C') {
    where = WHERES[(WHERES.indexOf(where) + 1) % 3];
    return say(`HAPPENED: ${where.toUpperCase()}`);
  }
  if (k === 'p' || k === 'P') {
    kind = kind === 'public' ? 'private' : 'public';
    sel = 0;
    return say(kind.toUpperCase());
  }
  if (k === 'o' || k === 'O') return setPhase('left');
  if (k === 'w' || k === 'W') {
    hideWords = !hideWords;
    return say(hideWords ? 'HELD WORDS HIDDEN' : 'HELD WORDS SHOWN');
  }
  if (k === 'r' || k === 'R') {
    drops = 0;
    reason = 'timeout';
    return setPhase('match');
  }
  if ((k === 'd' || k === 'D') && (phase === 'match' || phase === 'back')) return dropSignal();
  if ((k === 'x' || k === 'X') && phase === 'lost') return setPhase('back');
  if (phase === 'left') {
    const n = options().length;
    if (k === 'ArrowDown' || k === 'ArrowRight' || k === 'j' || k === 'l') sel = (sel + 1) % n;
    else if (k === 'ArrowUp' || k === 'ArrowLeft' || k === 'k' || k === 'h') sel = (sel + n - 1) % n;
    else if (k === 'Enter') say(`${options()[sel]}: not part of this prototype`);
  }
});
