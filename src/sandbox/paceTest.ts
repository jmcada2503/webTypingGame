// PROTOTYPE ("Juice: Pace-driven motion"): measures the player's Pace, one word at a time.
// Pace = letters of correct words per second, from the first key to the last submit (pauses
// count, as in the game). The result is the "fast" Pace in pacePrototype.
import '../app/app.css';
import { KeyboardTypingInput } from '../input/KeyboardTypingInput';
import { ASCII_STYLE } from '../render/asciiStyle';
import { SAMPLE_WORDS } from './SandboxSession';

const WORD_COUNT = 20;
const P = ASCII_STYLE.palette;

document.body.style.cssText = `margin:0;height:100vh;display:grid;place-items:center;background:#000;color:${P.fg};font-family:ui-monospace,Menlo,monospace`;
const box = document.createElement('div');
box.style.cssText = 'text-align:center;max-width:640px;padding:0 16px';
document.body.append(box);

const input = new KeyboardTypingInput();

let words: string[] = [];
let index = 0;
let typed = '';
let chars = 0;
let correct = 0;
let correctChars = 0;
let start = 0;
let flash: 'ok' | 'bad' | '' = '';

function shuffle<T>(a: T[]) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function begin() {
  words = shuffle([...SAMPLE_WORDS, ...shuffle([...SAMPLE_WORDS])]).slice(0, WORD_COUNT);
  index = 0;
  typed = '';
  chars = 0;
  correct = 0;
  correctChars = 0;
  start = 0;
  flash = '';
  input.clear();
  input.setEnabled(true);
  render();
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function render() {
  if (index >= words.length) return;
  const word = words[index];
  const t = [...typed];
  const w = [...word];
  let ok = 0;
  while (ok < t.length && t[ok] === w[ok]) ok++;
  const typedHtml =
    `<span style="color:${P.green}">${esc(t.slice(0, ok).join(''))}</span>` +
    `<span style="color:${P.red}">${esc(t.slice(ok).join(''))}</span>` +
    `<span style="color:${P.dim}">_</span>`;
  const border = flash === 'ok' ? P.green : flash === 'bad' ? P.red : '#333';
  box.innerHTML = `
    <div style="color:${P.dim};letter-spacing:.3em">PACE TEST</div>
    <div style="color:${P.dim};margin-top:6px;font-size:13px">Type each word, Space or Enter to submit. The clock starts on your first key.</div>
    <div style="margin:48px 0 8px;font-size:56px;padding:16px 24px;border:1px solid ${border};border-radius:6px">${esc(word)}</div>
    <div style="font-size:40px;min-height:56px">${typedHtml}</div>
    <div style="color:${P.dim};margin-top:32px">${index + 1} / ${words.length}${start ? '' : ' · waiting for your first key'}</div>`;
}

function finish() {
  input.setEnabled(false);
  const seconds = (performance.now() - start) / 1000;
  const pace = correctChars / seconds;
  box.innerHTML = `
    <div style="color:${P.dim};letter-spacing:.3em">PACE TEST</div>
    <div style="margin:40px 0 4px;font-size:64px;color:${P.yellow}">${pace.toFixed(2)}</div>
    <div style="color:${P.dim}">chars/s of correct words, your Pace (${Math.round((correct * 60) / seconds)} correct words/min)</div>
    <div style="margin-top:24px">${correct} / ${words.length} words right · ${chars} chars in ${seconds.toFixed(1)} s</div>
    <div style="margin-top:36px;display:flex;gap:16px;justify-content:center">
      <button id="again" style="font:inherit;padding:8px 16px;background:#111;color:${P.fg};border:1px solid #444;border-radius:4px;cursor:pointer">Again</button>
      <a href="/sandbox/?variant=A" style="font:inherit;padding:8px 16px;background:${P.yellow};color:#000;border-radius:4px;text-decoration:none">Open sandbox →</a>
    </div>`;
  box.querySelector<HTMLButtonElement>('#again')!.onclick = begin;
}

input.onChange((w) => {
  const added = [...w].length - [...typed].length;
  if (added > 0) {
    if (!start) start = performance.now();
    chars += added;
  }
  typed = w;
  flash = '';
  render();
});

input.onSubmit((w) => {
  if (!start || index >= words.length) return;
  const ok = w.normalize('NFC') === words[index].normalize('NFC');
  if (ok) {
    correct++;
    correctChars += [...words[index]].length;
  }
  flash = ok ? 'ok' : 'bad';
  typed = '';
  index++;
  if (index >= words.length) finish();
  else render();
});

begin();
