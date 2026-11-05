import { describe, expect, test } from 'vitest';
import type { SoundId } from '../audio/sounds';
import { FakeBackend } from '../flow/FakeNetwork';
import { ScreenFlow } from '../flow/ScreenFlow';
import type { FlowState } from '../flow/types';
import { onlineEndScreen } from './endScreens';
import { howtoScreen } from './howtoScreen';
import { menuScreen } from './menuScreen';
import { opponentLeftScreen } from './opponentLeftScreen';
import { practiceEndScreen } from './practiceEndScreen';
import type { Screen } from './Screen';
import { simpleScreens } from './simpleScreens';
import { waitingScreen } from './waitingScreen';

type KeyScreen = Pick<Screen, 'onKey' | 'enter'>;

/** Press keys on `screen` (shown for the flow's state) and collect the sounds it plays. */
function keys(flow: ScreenFlow, make: (play: (id: SoundId) => void) => KeyScreen) {
  const sounds: SoundId[] = [];
  const screen = make((id) => sounds.push(id));
  screen.enter?.(flow.state());
  const press = (...ks: string[]) => {
    for (const key of ks) screen.onKey?.({ key } as KeyboardEvent, flow.state());
    return sounds;
  };
  return { press, sounds };
}

const newFlow = () => new ScreenFlow(new FakeBackend().connect());
/** Let `seconds` pass on the flow, a frame at a time. */
const wait = (flow: ScreenFlow, seconds: number) => {
  for (let t = 0; t < seconds; t += 0.05) flow.update(0.05);
};

/** Two players in a Public match; returns the first one's flow. */
function inMatch() {
  const backend = new FakeBackend();
  const flow = new ScreenFlow(backend.connect());
  const otherEndpoint = backend.connect();
  const other = new ScreenFlow(otherEndpoint);
  other.choose('public');
  other.confirm();
  flow.choose('public');
  flow.confirm();
  wait(flow, 5 + 1.8 + 0.3);
  expect(flow.state().screen).toBe('match');
  return { flow, otherEndpoint };
}

describe('menu', () => {
  const menu = (flow = newFlow()) => keys(flow, (play) => menuScreen(flow, () => {}, undefined, undefined, null, play));

  test('moving plays the move blip; Enter confirms', () => {
    expect(menu().press('l', 'ArrowRight', 'h', 'Enter')).toEqual(['menuMove', 'menuMove', 'menuMove', 'menuConfirm']);
  });

  test('1-3 jump and confirm, Tab switches language, S copies the Sponsor link', () => {
    expect(menu().press('Tab')).toEqual(['language']);
    expect(menu().press('s')).toEqual(['sponsor']);
    expect(menu().press('1')).toEqual(['menuConfirm']);
  });

  test('while the servers rest, an online choice does nothing and makes no sound', () => {
    const flow = newFlow();
    flow.setServersResting(true);
    expect(menu(flow).press('2', '3')).toEqual([]);
  });
});

describe('how to play', () => {
  test('Enter starts now with a confirm; other keys are silent', () => {
    const flow = newFlow();
    flow.choose('public');
    expect(keys(flow, (play) => howtoScreen(flow, play)).press('x', 'Enter')).toEqual(['menuConfirm']);
  });
});

describe('waiting', () => {
  test('Q cancels with the back sound', () => {
    const flow = newFlow();
    flow.choose('public');
    flow.confirm();
    expect(keys(flow, (play) => waitingScreen(flow, () => {}, undefined, play)).press('q')).toEqual(['menuBack']);
  });

  test('C copies the Invite link, only once there is one', () => {
    const pub = newFlow();
    pub.choose('public');
    pub.confirm();
    expect(keys(pub, (play) => waitingScreen(pub, () => {}, undefined, play)).press('c')).toEqual([]);
    const priv = newFlow();
    priv.choose('private');
    priv.confirm();
    expect(priv.state()).toMatchObject({ screen: 'waiting', inviteLink: expect.any(String) });
    expect(keys(priv, (play) => waitingScreen(priv, () => {}, undefined, play)).press('c')).toEqual(['copyLink']);
  });
});

describe('Practice game over', () => {
  const practiceOver = () => {
    const flow = newFlow();
    flow.choose('practice');
    wait(flow, 2);
    flow.matchEnded('lost');
    expect(flow.state()).toMatchObject({ screen: 'end', mode: 'practice' });
    return flow;
  };

  test('moving blips, Enter on PLAY AGAIN confirms, Q goes back', () => {
    const flow = practiceOver();
    expect(keys(flow, (play) => practiceEndScreen(flow, () => null, undefined, { play })).press('l', 'h', 'Enter')).toEqual(['menuMove', 'menuMove', 'menuConfirm']);
    const other = practiceOver();
    expect(keys(other, (play) => practiceEndScreen(other, () => null, undefined, { play })).press('q')).toEqual(['menuBack']);
  });
});

describe('online end screen', () => {
  const ended = () => {
    const m = inMatch();
    m.flow.matchEnded('won');
    return m;
  };

  test('moving blips; Enter on REMATCH stays quiet (the Rematch proposed chime plays for it)', () => {
    const { flow } = ended();
    expect(keys(flow, (play) => onlineEndScreen(flow, () => null, play)).press('Enter')).toEqual([]);
    expect((flow.state() as Extract<FlowState, { screen: 'end'; mode: 'versus' }>).rematch.status).toBe('waiting');
  });

  test('Enter on MENU confirms', () => {
    const { flow } = ended();
    expect(keys(flow, (play) => onlineEndScreen(flow, () => null, play)).press('h', 'Enter')).toEqual(['menuMove', 'menuConfirm']); // wraps to the last option
    expect(flow.state().screen).toBe('menu');
  });

  test('taking back my Rematch request plays the back sound', () => {
    const { flow } = ended();
    const end = keys(flow, (play) => onlineEndScreen(flow, () => null, play));
    end.press('Enter'); // propose
    expect(end.press('Enter')).toEqual(['menuBack']); // the only option while waiting: cancel
  });
});

describe('opponent left and error', () => {
  test('opponent left: moving blips, Enter confirms', () => {
    const { flow, otherEndpoint } = inMatch();
    otherEndpoint.leave();
    wait(flow, 11);
    expect(flow.state().screen).toBe('opponentLeft');
    expect(keys(flow, (play) => opponentLeftScreen(flow, play)).press('j', 'Enter')).toEqual(['menuMove', 'menuConfirm']);
  });

  test('error: Q goes back, S searches again', () => {
    const errored = () => {
      const flow = newFlow();
      flow.joinInvite('nope');
      flow.confirm();
      return flow;
    };
    const flow = errored();
    expect(flow.state().screen).toBe('error');
    const screens = (play: (id: SoundId) => void) => simpleScreens(flow, undefined, undefined, { play }).error;
    expect(keys(flow, screens).press('q')).toEqual(['menuBack']);
  });
});
