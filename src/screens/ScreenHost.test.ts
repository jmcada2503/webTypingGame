import { describe, expect, test } from 'vitest';
import type { GameSession, SessionStatus } from '../app/GameSession';
import { FakeBackend } from '../flow/FakeNetwork';
import { ScreenFlow } from '../flow/ScreenFlow';
import type { PlayMode } from '../flow/types';
import type { TypingInput } from '../input/TypingInput';
import type { TextGrid } from '../render/AsciiRenderer';
import type { GameView } from '../view/GameView';
import { NOT_IDLE, type GameViewState, type ViewEvent } from '../view/GameViewState';
import { endingFrame, type EndingFrame } from './endings';
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
  ending: EndingFrame | null = null;
  setEnding(frame: EndingFrame | null) {
    this.ending = frame;
  }
}

const state = (lives: number, pace = 0): GameViewState => ({ lives, typedWord: '', attackWord: 'rocket', wordBullets: [], shots: [], enemyDamage: 0, pace: { player: pace, enemy: pace }, idle: NOT_IDLE });

/** A Match session the tests drive by hand. */
class FakeMatch implements GameSession {
  status: SessionStatus = 'idle';
  started = false;
  disposed = false;
  attached: TypingInput | null = null;
  updates = 0;
  next: ViewEvent[] = [];
  lives = 3;
  paceNow = 0;
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
    return state(this.lives, this.paceNow);
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
  const endpoint = backend.connect();
  const flow = new ScreenFlow(endpoint);
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
  return { flow, view, host, made, input, run, backend, endpoint };
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
    ctx.run(3.8 + 1.8 + 0.2); // the Lose ending, then TV off / black / on to the end screen

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

describe('Online endings', () => {
  /** An online Match that is running (the opponent is the fake backend's other player). */
  const intoOnlineMatch = () => {
    const ctx = setup();
    const otherEndpoint = ctx.backend.connect();
    const other = new ScreenFlow(otherEndpoint);
    other.choose('public');
    other.confirm();
    ctx.flow.choose('public');
    ctx.flow.confirm();
    ctx.run(5 + 1.8 + 0.3);
    expect(ctx.made[0].mode).toBe('versus');
    return { ...ctx, otherEndpoint };
  };
  const sceneIsShown = (ctx: ReturnType<typeof setup>) => ctx.view.screenDraw === null;

  test('a Win keeps the Match scene for 1.6 s with the ending applied, then changes to the end screen', () => {
    const ctx = intoOnlineMatch();
    ctx.made[0].status = 'won';

    ctx.run(0.1);
    expect(ctx.flow.state()).toMatchObject({ screen: 'end', result: 'won' }); // the flow already knows
    expect(sceneIsShown(ctx)).toBe(true); // but the scene is still on screen
    expect(ctx.view.ending).not.toBeNull();

    ctx.run(1.3);
    expect(sceneIsShown(ctx)).toBe(true);

    ctx.run(0.5); // 1.6 s have passed: the glitch (0.3 s) swaps the screen
    expect(sceneIsShown(ctx)).toBe(false);
    expect(ctx.view.ending).toBeNull();
  });

  test('the Win destroys the Enemy ship once, with its explosion event', () => {
    const ctx = intoOnlineMatch();
    ctx.made[0].status = 'won';

    const events = ctx.run(3);

    expect(events.filter((e) => e.type === 'enemyDestroyed')).toHaveLength(1);
  });

  test('a Lose waits 5.2 s, then the TV goes off, stays black for 1 s, and comes on at the end screen', () => {
    const ctx = intoOnlineMatch();
    ctx.made[0].status = 'lost';

    ctx.run(5.1);
    expect(sceneIsShown(ctx)).toBe(true);

    ctx.run(0.5 + 0.9); // TV off has swapped the screen, it is black for the 1 s hold
    expect(ctx.view.ending).toBeNull();

    ctx.run(1.5);
    expect(ctx.flow.state()).toMatchObject({ screen: 'end', result: 'lost' });
    expect(sceneIsShown(ctx)).toBe(false);
  });

  test('a Peace holds the scene for 4.6 s while the ending moves the ship away', () => {
    const ctx = intoOnlineMatch();
    ctx.made[0].status = 'peace';

    ctx.run(2);
    expect(ctx.view.ending?.enemyOffset.x).toBeGreaterThan(0);
    expect(sceneIsShown(ctx)).toBe(true);

    ctx.run(3);
    expect(sceneIsShown(ctx)).toBe(false);
  });

  test('the Rematch window only starts when the end screen is up, not while the ending plays', () => {
    const ctx = intoOnlineMatch();
    ctx.made[0].status = 'peace';

    ctx.run(3);
    expect(ctx.flow.state()).toMatchObject({ rematch: { status: 'available', secondsLeft: 10 } });

    ctx.run(2.2); // the ending is over and the screen has changed
    ctx.run(2);
    expect(ctx.flow.state()).toMatchObject({ rematch: { status: 'available' } });
    const left = (ctx.flow.state() as { rematch: { secondsLeft: number } }).rematch.secondsLeft;
    expect(left).toBeGreaterThan(7.5);
    expect(left).toBeLessThan(9);
  });

  test('after a Win and after a Lose the Rematch window starts at the same moment: when the loser\'s end screen is up', () => {
    const left = (ctx: ReturnType<typeof intoOnlineMatch>) => (ctx.flow.state() as { rematch: { secondsLeft: number } }).rematch.secondsLeft;
    const win = intoOnlineMatch();
    win.made[0].status = 'won';
    win.run(4); // the winner's end screen has been up for a while, but the clock waits
    expect(win.flow.state()).toMatchObject({ screen: 'end', result: 'won' });
    expect(left(win)).toBe(10);

    const lose = intoOnlineMatch();
    lose.made[0].status = 'lost';
    lose.run(5.3);
    expect(left(lose)).toBe(10);

    win.run(2.5); // 6.5 s after the result on both sides
    lose.run(1.2);
    expect(left(win)).toBeCloseTo(left(lose), 1);
    expect(left(win)).toBeLessThan(10);
    expect(left(win)).toBeGreaterThan(8.5);
  });

  test('typing stays off during the ending, and the Match session is not updated any more', () => {
    const ctx = intoOnlineMatch();
    ctx.made[0].status = 'lost';
    ctx.run(0.1);
    const updates = ctx.made[0].updates;

    ctx.run(2);

    expect(ctx.input.enabled.at(-1)).toBe(false);
    expect(ctx.made[0].updates).toBe(updates);
  });

  test('during a Peace the Idle nudge hands over to its PEACE!! label, and during a Lose the Pace slows to a stop', () => {
    const peace = intoOnlineMatch();
    peace.made[0].status = 'peace';
    peace.run(1);
    expect(peace.host.state().idle).toEqual({ nudging: false, opponentIdle: false, peaceIn: 0 });

    const lose = intoOnlineMatch();
    lose.made[0].paceNow = 4;
    lose.made[0].status = 'lost';
    lose.run(0.9);
    expect(lose.host.state().pace.player).toBeCloseTo(2, 0);
    lose.run(1);
    expect(lose.host.state().pace.player).toBeCloseTo(0, 5);
  });

  test('Practice plays the online Lose ending: 5.2 s of the Enemy ship flying over, then TV off / black / on', () => {
    const ctx = setup();
    intoPracticeMatch(ctx);
    ctx.made[0].paceNow = 2;
    ctx.made[0].status = 'lost';

    ctx.run(2);
    expect(ctx.flow.state()).toMatchObject({ screen: 'end', mode: 'practice' }); // the flow already knows
    expect(sceneIsShown(ctx)).toBe(true);
    expect(ctx.view.ending?.dim).toBeCloseTo(endingFrame('lost', 2).dim, 5); // the same frames as the online Lose
    expect(ctx.host.state().pace.player).toBeCloseTo(0, 5); // the stars have stopped

    ctx.run(3.1);
    expect(sceneIsShown(ctx)).toBe(true);

    ctx.run(0.5 + 0.9); // TV off has swapped the screen, black for the 1 s hold
    expect(ctx.view.ending).toBeNull();
    expect(sceneIsShown(ctx)).toBe(false);
  });

  test('an opponent who leaves ends the Match at once, with no ending scene', () => {
    const ctx = intoOnlineMatch();
    ctx.backend.drop(ctx.otherEndpoint); // the opponent's connection drops; after the grace they are gone
    ctx.run(10.5 + 0.5);

    expect(ctx.flow.state()).toMatchObject({ screen: 'opponentLeft' });
    expect(ctx.view.ending).toBeNull();
    expect(sceneIsShown(ctx)).toBe(false);
  });
});
