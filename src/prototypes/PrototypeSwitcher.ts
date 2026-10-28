// PROTOTYPE ONLY. Floating bottom bar that cycles ?variant= keys (← → also work). Dev builds only.
export function mountPrototypeSwitcher(variants: { key: string; name: string }[]): string {
  const params = new URLSearchParams(location.search);
  const keys = variants.map((v) => v.key);
  const current = keys.includes(params.get('variant') ?? '') ? params.get('variant')! : keys[0];
  if (!import.meta.env.DEV) return current;

  const go = (step: number) => {
    const i = (keys.indexOf(current) + step + keys.length) % keys.length;
    params.set('variant', keys[i]);
    location.search = params.toString();
  };

  const bar = document.createElement('div');
  bar.style.cssText =
    'position:fixed;top:16px;left:50%;transform:translateX(-50%);display:flex;gap:12px;align-items:center;' +
    'padding:8px 14px;border-radius:999px;background:#ffd400;color:#000;font:600 13px system-ui;' +
    'box-shadow:0 4px 16px rgba(0,0,0,.5);z-index:9999;user-select:none';
  const btn = (label: string, step: number) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      'border:0;background:#000;color:#ffd400;border-radius:999px;width:28px;height:28px;cursor:pointer;font-size:14px';
    b.onclick = () => go(step);
    return b;
  };
  const label = document.createElement('span');
  const v = variants.find((x) => x.key === current)!;
  label.textContent = `${v.key} (${v.name})`;
  bar.append(btn('←', -1), label, btn('→', 1));
  document.body.append(bar);

  addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    // The game's hidden typing field is always focused; only real form fields block the arrows.
    if (!t.matches('[data-typing-input]') && t.closest('input,textarea,[contenteditable],select')) return;
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === 'ArrowRight') go(1);
  });
  return current;
}
