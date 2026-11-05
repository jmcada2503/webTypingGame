// PROTOTYPE (throwaway, branch prototype/sound-settings): three ways to reach and change sound settings.
// Question (#153): where do sound settings live, how do ASCII sliders work with arrows / hjkl, quick mute, what the menu shows when muted.
// Wraps the real menu screen. Variants via ?variant=A|B|C (or [ and ] keys, or the bottom bar). State is in memory only; changes beep.
import type { PaletteColor, TextGrid } from '../../render/AsciiRenderer';
import { COLS, ROWS, blink, box, centered, put, twoTone } from '../draw';
import type { Screen } from '../Screen';

type V = 'A' | 'B' | 'C';
const VARIANTS: V[] = ['A', 'B', 'C'];
const NAMES: Record<V, string> = { A: 'Overlay panel (O)', B: 'Inline strip (V)', C: 'Own screen (O)' };

const s = { master: 70, sfx: 80, music: 50, keys: true, muted: false };
type Key = 'master' | 'sfx' | 'music' | 'keys';
const ROWS_ORDER: { key: Key; label: string }[] = [
  { key: 'master', label: 'MASTER' },
  { key: 'sfx', label: 'EFFECTS' },
  { key: 'music', label: 'MUSIC' },
  { key: 'keys', label: 'KEY CLICKS' },
];
const STEP = 5;

let ctx: AudioContext | null = null;
function beep(freq = 660) {
  try {
    ctx ??= new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    g.gain.value = s.muted ? 0 : (s.master / 100) * (s.sfx / 100) * 0.15;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.07);
  } catch {
    /* no audio, fine */
  }
}

const variant = (): V => {
  const v = new URLSearchParams(location.search).get('variant')?.toUpperCase();
  return v === 'B' || v === 'C' ? v : 'A';
};
function setVariant(v: V) {
  const u = new URL(location.href);
  u.searchParams.set('variant', v);
  history.replaceState(null, '', u);
  bar.textContent = barText();
}
const barText = () => `◀  ${variant()} — ${NAMES[variant()]}  ▶   ( [ ] cycles )`;
const bar = document.createElement('div');
Object.assign(bar.style, { position: 'fixed', bottom: '14px', left: '50%', transform: 'translateX(-50%)', zIndex: '99999', background: '#fff', color: '#000', font: '14px monospace', padding: '8px 16px', borderRadius: '99px', boxShadow: '0 2px 12px #000', cursor: 'pointer' });
bar.onclick = (e) => cycle(e.clientX < bar.getBoundingClientRect().left + bar.offsetWidth / 2 ? -1 : 1);
const cycle = (d: number) => setVariant(VARIANTS[(VARIANTS.indexOf(variant()) + d + VARIANTS.length) % VARIANTS.length]);

const barPct = (v: number, w: number) => '[' + '#'.repeat(Math.round((v / 100) * w)) + '-'.repeat(w - Math.round((v / 100) * w)) + ']';
const clamp = (v: number) => Math.max(0, Math.min(100, v));
function adjust(key: Key, d: number) {
  if (key === 'keys') s.keys = d > 0 ? true : d < 0 ? false : !s.keys;
  else {
    s[key] = clamp(s[key] + d * STEP);
    // Raising a volume while muted unmutes (otherwise the slider appears dead).
    if (d > 0) s.muted = false;
  }
  beep(key === 'music' ? 330 : key === 'keys' ? 880 : 660);
}
const valText = (key: Key) => (key === 'keys' ? (s.keys ? '< ON  >' : '< OFF >') : `${String(s[key]).padStart(3)}%`);

/** The chip every variant shows at the menu's top left: the quick mute key and the muted state. */
function chip(text: TextGrid, t: number, extra: string) {
  const off = s.muted || s.master === 0;
  const label = off ? '[M] SOUND OFF' : `[M] MUTE   SOUND ${s.master}%`;
  put(text, 4, 2, label, off ? (blink(t, 1.5) ? 'red' : 'dim') : 'dim');
  // The way in stands out by colour and pulse only; same glyph size as every other label.
  if (extra) put(text, 4, 4, extra, blink(t, 1) ? 'yellow' : 'fg');
}
const col = (on: boolean): PaletteColor => (on ? 'yellow' : 'fg');

export function soundSettingsProto(menu: Screen): Screen {
  document.body.appendChild(bar);
  bar.textContent = barText();
  addEventListener('keydown', (e) => {
    if (e.key === '[') cycle(-1);
    if (e.key === ']') cycle(1);
  });
  let open = false; // A / C: panel or screen is up. B: strip is focused.
  let row = 0;

  const keyChange = (k: string): number | null => (k === 'ArrowRight' || k === 'l' ? 1 : k === 'ArrowLeft' || k === 'h' ? -1 : null);

  return {
    enter: (st) => menu.enter?.(st),
    draw(text, t, st) {
      menu.draw(text, t, st);
      if (st.screen !== 'menu') return;
      const v = variant();
      if (v === 'A') {
        chip(text, t, open ? '' : '[O] SOUND SETTINGS');
        if (!open) return;
        const w = 62, c0 = (COLS - w) / 2, r0 = 12;
        box(text, c0, r0, w, 22, 'yellow');
        put(text, c0 + 3, r0, ' SOUND ', 'yellow');
        ROWS_ORDER.forEach((it, i) => {
          const y = r0 + 3 + i * 3;
          const on = i === row;
          put(text, c0 + 3, y, on ? '>' : ' ', 'yellow');
          put(text, c0 + 5, y, it.label.padEnd(11), col(on));
          if (it.key === 'keys') put(text, c0 + 17, y, valText('keys'), col(on));
          else {
            put(text, c0 + 17, y, barPct(s[it.key], 24), on ? (blink(t, 3) ? 'yellow' : 'fg') : 'dim');
            put(text, c0 + 43, y, valText(it.key), col(on));
          }
        });
        put(text, c0 + 5, r0 + 15, s.muted ? '[M] MUTED  (PRESS TO UNMUTE)' : '[M] MUTE ALL', s.muted ? 'red' : 'dim');
        put(text, c0 + 3, r0 + 18, 'J K ROW   H L CHANGE   M MUTE   Q / ESC BACK', 'dim');
      } else if (v === 'B') {
        chip(text, t, open ? '' : '[V] TUNE SOUND');
        const c0 = 19, r0 = 39;
        box(text, c0, r0, 90, 4, open ? 'yellow' : 'dim');
        put(text, c0 + 3, r0, open ? ' SOUND  H L PICK   J K CHANGE   Q / ESC BACK ' : ' SOUND ', open ? 'yellow' : 'dim');
        ROWS_ORDER.forEach((it, i) => {
          const x = c0 + 3 + i * 21;
          const on = open && i === row;
          put(text, x, r0 + 1, it.label, on ? 'yellow' : 'dim');
          if (it.key === 'keys') put(text, x, r0 + 2, valText('keys'), on ? 'yellow' : 'fg');
          else put(text, x, r0 + 2, barPct(s[it.key], 10) + valText(it.key), on ? (blink(t, 3) ? 'yellow' : 'fg') : 'fg');
        });
      } else {
        chip(text, t, open ? '' : '[O] SOUND SETTINGS');
        if (!open) return;
        text.fill(0, 0, COLS, ROWS, ' ');
        twoTone(text, 0.6, 'SOU', 'ND', 5.5);
        centered(text, 7.4, s.muted ? '** MUTED **' : 'TUNE THE SHIP', s.muted ? 'red' : 'dim');
        ROWS_ORDER.forEach((it, i) => {
          const y = 11 + i * 5;
          const on = i === row;
          text.writeScaled(16, y, (on ? '> ' : '  ') + it.label, 1.5, on ? 'yellow' : 'fg');
          if (it.key === 'keys') text.writeScaled(66, y, valText('keys'), 1.5, col(on));
          else {
            put(text, 56, y + 1, barPct(s[it.key], 40), on ? (blink(t, 3) ? 'yellow' : 'fg') : 'dim');
            text.writeScaled(100, y, valText(it.key), 1.5, col(on));
          }
        });
        // equalizer: bounces with the master * music level
        const lvl = s.muted ? 0 : (s.master / 100) * (0.3 + (s.music / 100) * 0.7);
        for (let x = 0; x < 48; x++) {
          const h = Math.round(lvl * 5 * (0.5 + 0.5 * Math.sin(t * 7 + x * 0.9) * Math.sin(t * 3 + x * 0.31)));
          for (let y = 0; y < h; y++) put(text, 40 + x, 38 - y, '|', y > 3 ? 'red' : y > 2 ? 'yellow' : 'green');
        }
        centered(text, 43, 'J K ROW   H L CHANGE   SPACE TEST BEEP   M MUTE   Q / ESC BACK', 'dim');
      }
    },
    onKey(e, st) {
      if (st.screen !== 'menu') return;
      const v = variant();
      const k = e.key;
      if (k === 'm' || k === 'M') {
        s.muted = !s.muted;
        if (!s.muted) beep();
        return;
      }
      if (!open) {
        if (((v === 'A' || v === 'C') && (k === 'o' || k === 'O')) || (v === 'B' && (k === 'v' || k === 'V'))) {
          open = true;
          row = 0;
          beep(440);
          return;
        }
        menu.onKey?.(e, st);
        return;
      }
      // Open: the panel owns every key.
      if (k === 'Escape' || k === 'q' || k === 'Q' || k === 'Enter' || k === 'o' || k === 'O' || k === 'v' || k === 'V') {
        open = false;
        return;
      }
      if (v === 'B') {
        const d = keyChange(k);
        if (d) row = (row + d + 4) % 4;
        else if (k === 'ArrowUp' || k === 'k') adjust(ROWS_ORDER[row].key, 1);
        else if (k === 'ArrowDown' || k === 'j') adjust(ROWS_ORDER[row].key, -1);
        return;
      }
      if (k === 'ArrowDown' || k === 'j' || k === 'Tab') row = (row + 1) % 4;
      else if (k === 'ArrowUp' || k === 'k') row = (row + 3) % 4;
      else if (keyChange(k)) adjust(ROWS_ORDER[row].key, keyChange(k)!);
      else if (k === ' ') beep();
    },
  };
}
