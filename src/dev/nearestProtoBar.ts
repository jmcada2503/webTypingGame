// PROTOTYPE, throwaway (ticket "Point to the next nearest Word bullet"): a floating bar to switch the variants
// live. Dev builds only. `[` / `]` or the arrows on the bar cycle; the choice goes into `?nearest=`.
import { NEAREST_PROTO } from '../view/words/WordBulletSprites';

const VARIANTS: [string, string][] = [
  ['off', 'today'],
  ['A', 'brightness by Flight'],
  ['B', 'next one glows'],
  ['C', 'bar under the next one'],
  ['D', 'A + B'],
  ['E', 'next one pale yellow'],
];

export function installNearestProtoBar() {
  const bar = document.createElement('div');
  bar.style.cssText =
    'position:fixed;bottom:12px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;gap:10px;align-items:center;' +
    'padding:6px 12px;border-radius:999px;background:#ff00aa;color:#fff;font:600 13px system-ui;box-shadow:0 2px 10px #0008;user-select:none';
  const label = document.createElement('span');
  const btn = (text: string, step: number) => {
    const b = document.createElement('button');
    b.textContent = text;
    b.style.cssText = 'background:none;border:0;color:#fff;font:700 16px system-ui;cursor:pointer';
    b.onmousedown = (e) => e.preventDefault(); // keep the keyboard on the game
    b.onclick = () => go(step);
    return b;
  };
  const index = () => Math.max(0, VARIANTS.findIndex(([k]) => k === NEAREST_PROTO.variant));
  const show = () => {
    const [k, name] = VARIANTS[index()];
    label.textContent = `nearest: ${k} (${name})`;
  };
  const go = (step: number) => {
    NEAREST_PROTO.variant = VARIANTS[(index() + step + VARIANTS.length) % VARIANTS.length][0];
    const url = new URL(location.href);
    url.searchParams.set('nearest', NEAREST_PROTO.variant);
    history.replaceState(history.state, '', url);
    show();
  };
  addEventListener('keydown', (e) => {
    if (e.key === '[') go(-1);
    if (e.key === ']') go(1);
  });
  bar.append(btn('←', -1), label, btn('→', 1));
  document.body.append(bar);
  show();
}
