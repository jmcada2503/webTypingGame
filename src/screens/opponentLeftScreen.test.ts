import { describe, expect, test } from 'vitest';
import { FakeBackend } from '../flow/FakeNetwork';
import { ScreenFlow } from '../flow/ScreenFlow';
import type { FlowState } from '../flow/types';
import { opponentLeftContent, opponentLeftScreen } from './opponentLeftScreen';

type Left = Extract<FlowState, { screen: 'opponentLeft' }>;
const left = (over: Partial<Left>): Left => ({ screen: 'opponentLeft', during: 'match', youWin: true, keptDropping: false, kind: 'public', ...over });
const ids = (s: Left) => opponentLeftContent(s).options.map((o) => o.id);

describe('what the Opponent left screen says', () => {
  test('the message depends on where it happened', () => {
    expect(opponentLeftContent(left({ during: 'waiting', youWin: false })).message).toBe('THE OTHER PLAYER LEFT BEFORE THE MATCH COULD START.');
    expect(opponentLeftContent(left({ during: 'countdown', youWin: false })).message).toBe('THE OTHER PLAYER LEFT DURING THE COUNTDOWN. THE MATCH NEVER STARTED.');
    expect(opponentLeftContent(left({ during: 'match' })).message).toBe('THE OTHER PLAYER LEFT THE MATCH AND DID NOT COME BACK IN 10 SECONDS.');
  });

  test('a Match ended by repeated drops says the connection kept dropping', () => {
    expect(opponentLeftContent(left({ keptDropping: true })).message).toBe("THE OTHER PLAYER'S CONNECTION KEPT DROPPING, SO THE MATCH WAS ENDED.");
  });

  test('YOU WIN only in a Match, otherwise NO RESULT', () => {
    expect(opponentLeftContent(left({ youWin: true })).result).toEqual({ kind: 'win', text: 'YOU WIN', note: 'THE MATCH ENDS HERE. THE RESULT COUNTS AS A WIN FOR YOU.' });
    expect(opponentLeftContent(left({ during: 'countdown', youWin: false })).result).toEqual({ kind: 'none', text: 'NO RESULT: NOBODY WON OR LOST.', note: null });
  });

  test('Public can search again or go to the menu, Private only the menu', () => {
    expect(ids(left({ kind: 'public' }))).toEqual(['search', 'menu']);
    expect(ids(left({ kind: 'private' }))).toEqual(['menu']);
  });
});

describe('choosing an option', () => {
  /** A Public or Private player whose opponent leaves during the Countdown. */
  const opponentGone = (kind: 'public' | 'private') => {
    const backend = new FakeBackend();
    const flow = new ScreenFlow(backend.connect());
    const otherEndpoint = backend.connect();
    const other = new ScreenFlow(otherEndpoint);
    if (kind === 'public') {
      other.choose('public');
      other.confirm();
      flow.choose('public');
      flow.confirm();
    } else {
      flow.choose('private');
      flow.confirm();
      const s = flow.state();
      other.joinInvite((s as { inviteLink: string }).inviteLink.split('/m/')[1]);
      other.confirm();
    }
    otherEndpoint.leave(); // the first player is told
    expect(flow.state().screen).toBe('opponentLeft');
    const screen = opponentLeftScreen(flow);
    screen.enter?.(flow.state());
    const press = (key: string) => screen.onKey?.({ key } as KeyboardEvent, flow.state());
    return { flow, press };
  };

  test('Enter on the first option, Search again, searches for a new opponent', () => {
    const { flow, press } = opponentGone('public');
    press('Enter');
    expect(flow.state()).toMatchObject({ screen: 'waiting', kind: 'public', phase: 'searching' });
  });

  test('down, j and l move to the next option, up, k and h back, wrapping round', () => {
    for (const next of ['ArrowDown', 'ArrowRight', 'j', 'l']) {
      const { flow, press } = opponentGone('public');
      press(next);
      press('Enter');
      expect(flow.state().screen).toBe('menu');
    }
    for (const back of ['ArrowUp', 'ArrowLeft', 'k', 'h']) {
      const { flow, press } = opponentGone('public');
      press(back); // wraps to the last option: Menu
      press('Enter');
      expect(flow.state().screen).toBe('menu');
    }
  });

  test('in a Private match Enter goes to the menu, and moving does nothing else', () => {
    const { flow, press } = opponentGone('private');
    press('j');
    press('Enter');
    expect(flow.state().screen).toBe('menu');
  });

  test('the old S and Q shortcuts are gone', () => {
    const { flow, press } = opponentGone('public');
    press('s');
    press('q');
    expect(flow.state().screen).toBe('opponentLeft');
  });

  test('arriving on the screen again starts on the first option', () => {
    const { flow, press } = opponentGone('public');
    press('j');
    const screen = opponentLeftScreen(flow);
    screen.enter?.(flow.state());
    screen.onKey?.({ key: 'Enter' } as KeyboardEvent, flow.state());
    expect(flow.state().screen).toBe('waiting'); // a fresh screen: Search again is selected
  });
});
