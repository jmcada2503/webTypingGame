// PROTOTYPE (sound style, throwaway, dev only): three sound styles playing in the real game, switchable with
// `?variant=A|B|C` (bottom bar, or Alt+← / Alt+→), plus a soundboard with every sound of the event catalog.
// Hooks only watch the game (host events, flow state, typing input); nothing in the game changes.
import type { ScreenFlow } from '../../flow/ScreenFlow';
import type { TypingInput } from '../../input/TypingInput';
import { SCREEN_TRANSITION } from '../../render/ScreenFilters';
import type { ScreenHost } from '../../screens/ScreenHost';
import type { ViewEvent } from '../../view/GameViewState';
import { SOUNDS, type SoundId, type SoundStyle } from './catalog';
import { SR } from './synth';
import { arcade } from './styleArcade';
import { cockpit } from './styleCockpit';
import { terminal } from './styleTerminal';

const STYLES: SoundStyle[] = [arcade, cockpit, terminal];
const KEY_SOUNDS = new Set<SoundId>(['keyMatch', 'keyNoMatch', 'keyBackspace']);
const TOGGLED_KEYS = new Set<SoundId>(['keyMatch', 'keyBackspace']); // the keystroke toggle mutes only these

class ProtoAudio {
  readonly ctx = new AudioContext({ sampleRate: SR });
  readonly master = this.ctx.createGain();
  private buffers = new Map<SoundId, AudioBuffer[]>();
  private loops = new Map<SoundId, { src: AudioBufferSourceNode; g: GainNode }>();
  keystrokes = true;
  onPlay: (id: SoundId) => void = () => {};

  constructor() {
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);
  }

  setStyle(style: SoundStyle) {
    for (const id of [...this.loops.keys()]) this.stopLoop(id);
    this.buffers.clear();
    const t0 = performance.now();
    for (const s of SOUNDS) {
      const made = style.sounds[s.id]();
      const list = Array.isArray(made) ? made : [made];
      this.buffers.set(s.id, list.map((data) => this.toBuffer(data)));
    }
    console.info(`[sound-proto] style ${style.key} (${style.name}) built in ${Math.round(performance.now() - t0)} ms`);
  }

  private toBuffer(data: Float32Array) {
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v));
    const scale = peak > 0.95 ? 0.95 / peak : 1; // clip guard only; loudness is designed per sound
    const buf = this.ctx.createBuffer(1, Math.max(1, data.length), SR);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) ch[i] = data[i] * scale;
    return buf;
  }

  play(id: SoundId, vol = 1) {
    if (this.ctx.state !== 'running') return;
    if (!this.keystrokes && TOGGLED_KEYS.has(id)) return;
    const list = this.buffers.get(id);
    if (!list?.length) return;
    const src = this.ctx.createBufferSource();
    src.buffer = list[Math.floor(Math.random() * list.length)];
    if (KEY_SOUNDS.has(id)) src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.06; // per-press variation
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(this.master);
    src.start();
    this.onPlay(id);
  }

  loop(id: SoundId, vol: number) {
    if (this.ctx.state !== 'running') return;
    let l = this.loops.get(id);
    if (!l) {
      const buf = this.buffers.get(id)?.[0];
      if (!buf) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      src.connect(g).connect(this.master);
      src.start();
      l = { src, g };
      this.loops.set(id, l);
      this.onPlay(id);
    }
    l.g.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.15);
  }

  stopLoop(id: SoundId) {
    const l = this.loops.get(id);
    if (!l) return;
    l.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
    l.src.stop(this.ctx.currentTime + 0.5);
    this.loops.delete(id);
  }

  looping(id: SoundId) {
    return this.loops.has(id);
  }
}

const same = (a: string, b: string) => a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase();

export function installSoundStylePrototype(host: ScreenHost, flow: ScreenFlow, input: TypingInput) {
  const audio = new ProtoAudio();
  const params = new URLSearchParams(location.search);
  let styleIndex = Math.max(0, STYLES.findIndex((s) => s.key === (params.get('variant') ?? 'A').toUpperCase()));
  audio.setStyle(STYLES[styleIndex]);

  const ui = mountUi(audio, () => STYLES[styleIndex], (dir) => {
    styleIndex = (styleIndex + dir + STYLES.length) % STYLES.length;
    const p = new URLSearchParams(location.search);
    p.set('variant', STYLES[styleIndex].key);
    history.replaceState(null, '', `${location.pathname}?${p}${location.hash}`);
    audio.setStyle(STYLES[styleIndex]);
    ui.refresh();
    audio.play('menuConfirm');
  });

  // Browsers keep audio off until the first key or click.
  const unlock = () => void (audio.ctx.state !== 'running' && audio.ctx.resume().then(() => ui.refresh()));
  addEventListener('keydown', unlock, true);
  addEventListener('pointerdown', unlock, true);

  // --- Typing: matching / no-match / Backspace / wrong submit. Subscribed before any Match, so it runs first. ---
  let prevWord = '';
  let submitted = false;
  input.onSubmit((word) => {
    const s = host.state();
    const ok = s.wordBullets.some((b) => same(b.word, word)) || (s.attackWord !== '' && same(s.attackWord, word));
    if (!ok) audio.play('wrongSubmit'); // a successful submit plays only its event sound
    submitted = true;
  });
  input.onChange((word) => {
    const was = prevWord;
    prevWord = word;
    if (submitted) return void (submitted = false);
    if (host.screenShown !== 'match') return;
    if (word.length > was.length) {
      const s = host.state();
      const targets = [...s.wordBullets.map((b) => b.word), s.attackWord].filter(Boolean);
      audio.play(targets.some((t) => t.normalize('NFC').toLowerCase().startsWith(word)) ? 'keyMatch' : 'keyNoMatch');
    } else if (word.length === was.length - 1) audio.play('keyBackspace'); // a clear (Match over, held) is silent
  });

  // --- Screen keys (not in the Match, where letters are typed). ---
  addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      ui.cycle(e.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || host.screenShown === 'match' || SCREEN_TRANSITION.level > 0) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const screen = flow.state().screen;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'h', 'j', 'k', 'l'].includes(k)) audio.play('menuMove');
    else if (k === 'Enter') audio.play('menuConfirm');
    else if (k === 'q' || k === 'Escape') audio.play('menuBack');
    else if (k === 's' && screen === 'menu') audio.play('sponsor');
    else if (k === 'c' && screen === 'waiting') audio.play('copyLink');
    else if (k === 'Tab' && screen === 'menu') audio.play('language');
  });

  // --- Each frame: game events, and changes in the flow and the scene. ---
  let prev = flow.state();
  let prevLevel = 0;
  let tvHidden = false;
  let prevLives = 3;
  let prevPeaceIn: number | null = null;
  let prevTick = -1;
  const warned = new Set<string>();
  let scoreTicksLeft = 0;
  let scoreClock = 0;
  const later = (s: number, f: () => void) => setTimeout(f, s * 1000);

  const original = host.update.bind(host);
  host.update = (dt: number): ViewEvent[] => {
    const events = original(dt);
    const s = flow.state();
    const view = host.state();

    for (const e of events) {
      if (e.type === 'wordBulletDestroyed' || e.type === 'attackFired' || e.type === 'shotHit' || e.type === 'shotDefended' || e.type === 'enemyFired' || e.type === 'lifeLost' || e.type === 'idleNudge') audio.play(e.type);
    }

    // Screen-change effects: glitch, or TV off then on.
    const level = SCREEN_TRANSITION.level;
    if (prevLevel === 0 && level > 0) audio.play(SCREEN_TRANSITION.mode === 2 ? 'tvOff' : 'glitch');
    if (SCREEN_TRANSITION.mode === 2) {
      if (level >= 0.999) tvHidden = true;
      else if (tvHidden && level < 0.98) {
        tvHidden = false;
        audio.play('tvOn');
      }
    }
    prevLevel = level;

    // The Match scene: last Life, close warning, PEACE IN ticks, damage hum.
    const inMatch = host.screenShown === 'match' && s.screen === 'match';
    if (inMatch) {
      if (view.lives === 1 && prevLives > 1) later(0.35, () => audio.play('lastLife'));
      prevLives = view.lives;
      const ids = new Set(view.wordBullets.map((b) => b.id));
      for (const b of view.wordBullets) if (b.flight >= 0.8 && !warned.has(b.id)) warned.add(b.id), audio.play('closeWarning');
      for (const id of warned) if (!ids.has(id)) warned.delete(id);
      const p = view.idle.peaceIn;
      if (p !== null && p > 0 && (prevPeaceIn === null || Math.ceil(p) !== Math.ceil(prevPeaceIn))) audio.play('peaceTick');
      prevPeaceIn = p;
      if (view.lives < 3 && view.lives > 0) audio.loop('damageHum', view.lives === 2 ? 0.45 : 1);
      else audio.stopLoop('damageHum');
    } else {
      prevLives = 3;
      prevPeaceIn = null;
      warned.clear();
      if (audio.looping('damageHum') && host.screenShown !== 'match') audio.stopLoop('damageHum');
    }

    // Flow changes.
    if (s.screen !== prev.screen) {
      if (s.screen === 'end' && prev.screen === 'match') audio.play(s.mode === 'practice' || s.result === 'lost' ? 'loseEnding' : s.result === 'won' ? 'winEnding' : 'peaceEnding');
      if (s.screen === 'match' && s.mode === 'versus') audio.play('go');
      if (s.screen === 'countdown' && prev.screen === 'end') audio.play('rematchAccepted');
      if (s.screen === 'opponentLeft') audio.play(s.youWin ? 'opponentLeftWin' : 'errorSting');
      if (s.screen === 'error') audio.play('errorSting');
      prevTick = -1;
    }
    if (s.screen === 'menu' && prev.screen === 'menu' && s.serversResting && !prev.serversResting) audio.play('errorSting');
    if (s.screen === 'waiting' && prev.screen === 'waiting' && s.phase === 'connecting' && prev.phase === 'searching') audio.play('opponentFound');
    if (s.screen === 'waiting' && prev.screen === 'waiting' && s.phase === 'connecting' && prev.phase === 'connecting') {
      // nothing: music would carry the wait
    }
    if (s.screen === 'countdown') {
      const n = Math.ceil(s.secondsLeft);
      if (n !== prevTick && n > 0) audio.play('countdownTick');
      prevTick = n;
    }
    if (s.screen === 'end' && s.mode === 'versus' && prev.screen === 'end' && prev.mode === 'versus') {
      const a = s.rematch;
      const b = prev.rematch;
      if (a.status !== b.status) {
        if (a.status === 'waiting' || a.status === 'incoming') audio.play('rematchProposed');
        if (a.status === 'notice' && a.notice === 'declined') audio.play('rematchDeclined');
      }
    }
    // Link effects.
    const link = s.screen === 'match' ? s.link : { status: 'ok' as const };
    const prevLink = prev.screen === 'match' ? prev.link : { status: 'ok' as const };
    if (link.status === 'away' && prevLink.status !== 'away') {
      audio.play('signalLost');
      later(0.4, () => flow.state().screen === 'match' && audio.loop('reconnecting', 1));
    }
    if (link.status !== 'away') audio.stopLoop('reconnecting');
    if (link.status === 'back') {
      if (prevLink.status !== 'back') audio.play('enemyBack'), (prevTick = Math.ceil(link.secondsLeft));
      const n = Math.ceil(link.secondsLeft);
      if (n !== prevTick && n > 0 && n <= 5) audio.play('resumeTick');
      prevTick = n;
    }

    // Practice game over: the score counts up for 1.2 s once the screen is up.
    if (host.screenShown === 'end' && s.screen === 'end' && s.mode === 'practice' && SCREEN_TRANSITION.level === 0 && scoreTicksLeft === 0 && scoreClock === 0) scoreTicksLeft = 17;
    if (scoreTicksLeft > 0 && (scoreClock += dt) >= 0.07) {
      scoreClock = 0.0001;
      scoreTicksLeft--;
      audio.play('scoreTick');
    }
    if (s.screen !== 'end') scoreClock = 0;

    prev = s;
    return events;
  };
}

// ---------------------------------------------------------------------------------------------------------------
// UI: the floating variant bar and the soundboard (visibly not part of the game).

function mountUi(audio: ProtoAudio, current: () => SoundStyle, cycle: (dir: number) => void) {
  const css = document.createElement('style');
  css.textContent = `
  .sp-bar{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:9999;display:flex;align-items:center;gap:10px;
    background:#fff;color:#111;font:600 13px system-ui,sans-serif;border-radius:999px;padding:6px 10px;box-shadow:0 4px 18px #0008}
  .sp-bar button{border:0;background:#111;color:#fff;border-radius:999px;width:28px;height:28px;cursor:pointer;font-size:14px}
  .sp-bar small{font-weight:400;color:#666}
  .sp-board{position:fixed;left:10px;top:10px;z-index:9999;width:250px;max-height:calc(100vh - 80px);overflow:auto;background:#fffffff2;color:#111;
    font:12px system-ui,sans-serif;border-radius:10px;box-shadow:0 4px 18px #0008;padding:8px}
  .sp-board.closed .sp-body{display:none}
  .sp-board h4{margin:8px 0 3px;font-size:11px;text-transform:uppercase;color:#666}
  .sp-board .sp-head{display:flex;justify-content:space-between;align-items:center;font-weight:700;cursor:pointer}
  .sp-snd{display:block;width:100%;text-align:left;margin:2px 0;padding:3px 6px;border-radius:5px;border:1px solid #ccc;border-left-width:6px;background:#fff;cursor:pointer;font:12px system-ui}
  .sp-good{border-left-color:#1a9a3a}.sp-bad{border-left-color:#d22}.sp-neutral{border-left-color:#999}
  .sp-snd.on{background:#ffe9a8}
  .sp-row{display:flex;gap:4px;margin:4px 0;align-items:center;flex-wrap:wrap}
  .sp-row button{font:12px system-ui;padding:3px 6px;cursor:pointer}
  .sp-log{font:11px ui-monospace,monospace;color:#333;background:#f2f2f2;border-radius:5px;padding:4px;margin-top:6px;min-height:60px;white-space:pre}
  .sp-warn{color:#b00;font-weight:600}
  .sp-idea{color:#444;margin:4px 0}`;
  document.head.append(css);

  const bar = document.createElement('div');
  bar.className = 'sp-bar';
  bar.innerHTML = `<button data-d="-1">◀</button><span class="sp-label"></span><button data-d="1">▶</button><small>Alt+← / Alt+→</small>`;
  bar.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => cycle(Number(b.dataset.d))));
  document.body.append(bar);

  const board = document.createElement('div');
  board.className = 'sp-board';
  const groups = [...new Set(SOUNDS.map((s) => s.group))];
  board.innerHTML = `<div class="sp-head"><span>SOUND STYLE PROTOTYPE</span><span class="sp-toggle">▾</span></div>
  <div class="sp-body">
    <div class="sp-warn" hidden>Press any key to turn audio on.</div>
    <div class="sp-idea"></div>
    <div class="sp-row">vol <input type="range" min="0" max="1" step="0.05" value="0.8" class="sp-vol"> <label><input type="checkbox" class="sp-keys" checked> keystrokes</label></div>
    <div class="sp-row"><button data-seq="good">▶ all good</button><button data-seq="bad">▶ all bad</button><button data-seq="pair">▶ good/bad pairs</button></div>
    <div class="sp-row" style="color:#666">border: <span style="color:#1a9a3a">■ good</span> <span style="color:#d22">■ bad</span> <span style="color:#999">■ neutral</span></div>
    ${groups.map((g) => `<h4>${g}</h4>${SOUNDS.filter((s) => s.group === g).map((s) => `<button class="sp-snd sp-${s.pol}" data-id="${s.id}">${s.label}</button>`).join('')}`).join('')}
    <div class="sp-log"></div>
  </div>`;
  document.body.append(board);
  board.querySelector('.sp-head')!.addEventListener('click', () => board.classList.toggle('closed'));
  board.querySelector<HTMLInputElement>('.sp-vol')!.addEventListener('input', (e) => (audio.master.gain.value = Number((e.target as HTMLInputElement).value)));
  board.querySelector<HTMLInputElement>('.sp-keys')!.addEventListener('change', (e) => (audio.keystrokes = (e.target as HTMLInputElement).checked));

  const loopIds = new Set<SoundId>(SOUNDS.filter((s) => 'loop' in s && s.loop).map((s) => s.id));
  board.querySelectorAll<HTMLButtonElement>('.sp-snd').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.id as SoundId;
      if (!loopIds.has(id)) return audio.play(id);
      if (audio.looping(id)) audio.stopLoop(id);
      else audio.loop(id, 1);
      b.classList.toggle('on', audio.looping(id));
    }),
  );

  // Sequences for comparing polarity: every good sound, every bad one, or good/bad pairs back to back.
  const short = (pol: string) => SOUNDS.filter((s) => s.pol === pol && !('loop' in s) && s.group !== 'Endings').map((s) => s.id);
  const pairs: SoundId[] = ['keyMatch', 'keyNoMatch', 'wordBulletDestroyed', 'lifeLost', 'attackFired', 'enemyFired', 'shotHit', 'shotDefended', 'rematchAccepted', 'rematchDeclined', 'enemyBack', 'signalLost'];
  let seqTimer = 0;
  board.querySelectorAll<HTMLButtonElement>('[data-seq]').forEach((b) =>
    b.addEventListener('click', () => {
      clearTimeout(seqTimer);
      const list = b.dataset.seq === 'pair' ? pairs : short(b.dataset.seq!);
      let i = 0;
      const next = () => {
        if (i >= list.length) return;
        audio.play(list[i]);
        const gap = b.dataset.seq === 'pair' && i % 2 === 0 ? 450 : 750;
        i++;
        seqTimer = window.setTimeout(next, gap);
      };
      next();
    }),
  );

  // The state on screen: which style, and the last sounds played.
  const log: string[] = [];
  const logEl = board.querySelector('.sp-log')!;
  audio.onPlay = (id) => {
    log.unshift(`${current().key} ${id}`);
    log.length = Math.min(log.length, 8);
    logEl.textContent = log.join('\n');
  };

  const refresh = () => {
    const s = current();
    bar.querySelector('.sp-label')!.textContent = `${s.key} · ${s.name}`;
    board.querySelector('.sp-idea')!.textContent = s.idea;
    board.querySelector<HTMLElement>('.sp-warn')!.hidden = audio.ctx.state === 'running';
  };
  refresh();
  return { refresh, cycle };
}
