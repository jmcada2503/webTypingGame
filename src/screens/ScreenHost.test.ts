import { describe, expect, test } from 'vitest';
import type { GameSession, SessionStatus } from '../app/GameSession';
import { FakeBackend } from '../flow/FakeNetwork';
import { ScreenFlow } from '../flow/ScreenFlow';
import type { PlayMode } from '../flow/types';
import type { TypingInput } from '../input/TypingInput';
import type { TextGrid } from '../render/AsciiRenderer';
import type { GameView } from '../view/GameView';
import { NOT_IDLE, type GameViewState, type ViewEvent } from '../view/GameViewState';
import type { Screen, ScreenSet } from './Screen';
import { ScreenHost } from './ScreenHost';

class FakeView implements GameView {
  canvas = {} as HTMLCanvasElement;
  screenDraw: unknown = 'unset';
  overlayDraw: ((text: TextGrid, dt: number) => void) | null = null;
  render() {}
  trigger() {}
  resize() {}
  dispose() {}
  setScreen(draw: unknown) {
    this.screenDraw = draw;
  }
  setOverlay(draw: ((text: TextGrid, dt: number) => void) | null) {
    this.overlayDraw = draw;
  }
}

const state = (lives: number): GameViewState => ({ lives, typedWord: '', attackWord: '', wordBullets: [], shots: [], enemyDamage: 0, pace: { player: 0, enemy: 0 }, idle: NOT_IDLE });

/** A Match session the tests drive by hand. */
class FakeMatch implements GameSession {
  status: SessionStatus = 'idle';
  started = false;
  disposed = false;
  attached: TypingInput | null = null;
  updates = 0;
  next: ViewEvent[] = [];
  lives = 3;
  constructor(readonly mode: PlayMode) {}
  start() {
    this.started = true;
    this.status = 'running';
  }
  dispose() {
    this.disposed = true;
  }
  attachInput(input: TypingInput) {
    this.attached = input;
  }
  update() {
    this.updates++;
    const events = this.next;
    this.next = [];
    return events;
  }
  state() {
    return state(this.lives);
  }
}

class FakeInput implements TypingInput {
  typedWord = '';
  enabled: boolean[] = [];
  onChange() {
    return () => {};
  }
  onSubmit() {
    return () => {};
  }
  clear() {}
  setEnabled(on: boolean) {
    this.enabled.push(on);
  }
  dispose() {}
}

const blankScreen: Screen = { draw() {} };
const screens = (): ScreenSet => ({ menu: blankScreen, howto: blankScreen, waiting: blankScreen, countdown: blankScreen, match: blankScreen, end: blankScreen, opponentLeft: blankScreen, error: blankScreen });

const setup = () => {
  const backend = new FakeBackend();
  const flow = new ScreenFlow(backend.connect());
  const view = new FakeView();
  const made: FakeMatch[] = [];
  const host = new ScreenHost(view, flow, screens(), (mode) => {
    const m = new FakeMatch(mode);
    made.push(m);
    return m;
  });
  const input = new FakeInput();
  host.attachInput(input);
  /** Advance the app in small frames. */
  const run = (seconds: number) => {
    const events: ViewEvent[] = [];
    for (let t = 0; t < seconds - 1e-9; t += 0.05) events.push(...host.update(0.05));
    return events;
  };
  return { flow, view, host, made, input, run, backend };
};
/** Practice, from the menu to the first frame of the running Match. */
const intoPracticeMatch = (ctx: ReturnType<typeof setup>) => {
  ctx.flow.choose('practice');
  ctx.run(1.8 + 0.3);
};

describe('The Match screen', () => {
  test('a Match session is created only when the Match begins, not during the TV gap', () => {
    const ctx = setup();
    ctx.flow.choose('practice'); // Practice has no Countdown: straight to the TV gap

    ctx.run(1.5);
    expect(ctx.flow.state().screen).toBe('starting');
    expect(ctx.made).toHaveLength(0);

    ctx.run(0.5);
    expect(ctx.flow.state().screen).toBe('match');
    expect(ctx.made).toHaveLength(1);
    expect(ctx.made[0].mode).toBe('practice');
    expect(ctx.made[0].started).toBe(true);
  });

  test('the new session gets the typing input', () => {
    const ctx = setup();
    intoPracticeMatch(ctx);
    expect(ctx.made[0].attached).toBe(ctx.input);
  });

  test('while the Match runs, its events and snapshot go to the view', () => {
    const ctx = setup();
    intoPracticeMatch(ctx);
    ctx.made[0].lives = 2;
    ctx.made[0].next = [{ type: 'lifeLost' }];

    expect(ctx.host.update(0.05)).toEqual([{ type: 'lifeLost' }]);
    expect(ctx.host.state().lives).toBe(2);
  });

  test('before the Match begins the game scene is idle (full Lives, nothing flying)', () => {
    const ctx = setup();
    expect(ctx.host.state()).toMatchObject({ lives: 3, wordBullets: [] });
  });

  test('when the session ends, the flow is told how it went and shows the end screen', () => {
    const ctx = setup();
    intoPracticeMatch(ctx);

    ctx.made[0].status = 'lost';
    ctx.run(0.1);

    expect(ctx.flow.state()).toMatchObject({ screen: 'end', mode: 'practice' });
  });

  test.each(['won', 'lost', 'peace'] as const)('an online %s Match is reported as it ended', (result) => {
    const ctx = setup();
    const other = new ScreenFlow(ctx.backend.connect());
    other.choose('public');
    other.confirm();
    ctx.flow.choose('public');
    ctx.flow.confirm(); // pairs with the other player: Countdown for both
    ctx.run(5 + 1.8 + 0.3);
    expect(ctx.made[0].mode).toBe('versus');

    ctx.made[0].status = result;
    ctx.run(0.1);

    expect(ctx.flow.state()).toMatchObject({ screen: 'end', mode: 'versus', result });
  });

  test('a session is not updated again once it has ended', () => {
    const ctx = setup();
    intoPracticeMatch(ctx);
    ctx.made[0].status = 'lost';
    ctx.run(0.1);
    const updates = ctx.made[0].updates;

    ctx.run(1);

    expect(ctx.made[0].updates).toBe(updates);
  });

  test('playing again creates a fresh session and disposes the old one', () => {
    const ctx = setup();
    intoPracticeMatch(ctx);
    ctx.made[0].status = 'lost';
    ctx.run(1); // glitch to the end screen

    ctx.flow.playAgain();
    ctx.run(1.8 + 0.5);

    expect(ctx.made).toHaveLength(2);
    expect(ctx.made[0].disposed).toBe(true);
    expect(ctx.made[1].started).toBe(true);
  });
});

describe('Input and the GO flash', () => {
  test('typing is only on while the Match runs and no screen-change effect is playing', () => {
    const ctx = setup();
    expect(ctx.input.enabled.at(-1)).toBe(false);

    ctx.flow.choose('practice');
    ctx.run(1.5);
    expect(ctx.input.enabled.at(-1)).toBe(false); // still in the TV gap

    ctx.run(0.5);
    expect(ctx.input.enabled.at(-1)).toBe(true);

    ctx.made[0].status = 'lost';
    ctx.run(0.3); // the glitch to the end screen starts
    expect(ctx.input.enabled.at(-1)).toBe(false);
  });

  test('the GO flash is drawn over an online Match right after it begins, and removed afterwards', () => {
    const ctx = setup();
    const other = new ScreenFlow(ctx.backend.connect());
    other.choose('public');
    other.confirm();
    ctx.flow.choose('public');
    ctx.flow.confirm();
    ctx.run(5 + 1.8 + 0.05);
    expect(ctx.view.overlayDraw).not.toBeNull();

    ctx.run(1.5);
    expect(ctx.view.overlayDraw).toBeNull();
  });

  test('Practice has no Countdown, so no GO flash either', () => {
    const ctx = setup();
    ctx.flow.choose('practice');
    ctx.run(1.8 + 0.05);
    expect(ctx.made).toHaveLength(1);
    expect(ctx.view.overlayDraw).toBeNull();
  });
});
