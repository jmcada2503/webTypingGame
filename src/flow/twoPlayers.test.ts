import { describe, expect, test } from 'vitest';
import { FakeBackend } from './FakeNetwork';
import { ScreenFlow } from './ScreenFlow';

/** Two players on two separate flows, both talking to one in-memory backend. */
const twoPlayers = (languages: ['en' | 'es', 'en' | 'es'] = ['en', 'en']) => {
  const backend = new FakeBackend();
  const a = backend.connect();
  const b = backend.connect();
  const flowA = new ScreenFlow(a);
  const flowB = new ScreenFlow(b);
  flowA.setLanguage(languages[0]);
  flowB.setLanguage(languages[1]);
  const tick = (seconds: number) => {
    flowA.update(seconds);
    flowB.update(seconds);
  };
  return { backend, a, b, flowA, flowB, tick };
};
const screens = (p: ReturnType<typeof twoPlayers>) => [p.flowA.state().screen, p.flowB.state().screen];

/** Both players start a Public match; the second to join pairs them. */
const bothSearching = (p: ReturnType<typeof twoPlayers>) => {
  p.flowA.choose('public');
  p.flowA.confirm();
  p.flowB.choose('public');
  p.flowB.confirm();
};

describe('Two players through the fake network', () => {
  test('a Public match: both go from the menu to the Countdown together, then into the Match', () => {
    const p = twoPlayers();
    bothSearching(p);
    expect(screens(p)).toEqual(['countdown', 'countdown']);

    p.tick(5);
    expect(screens(p)).toEqual(['starting', 'starting']);
    p.tick(1.8);
    expect(screens(p)).toEqual(['match', 'match']);
  });

  test('the first player keeps waiting until someone else is looking', () => {
    const p = twoPlayers();
    p.flowA.choose('public');
    p.flowA.confirm();
    expect(screens(p)).toEqual(['waiting', 'menu']);
  });

  test('players looking in different languages are not paired', () => {
    const p = twoPlayers(['en', 'es']);
    bothSearching(p);
    expect(screens(p)).toEqual(['waiting', 'waiting']);
  });

  test('a player who cancels the search is not paired with the next one', () => {
    const p = twoPlayers();
    p.flowA.choose('public');
    p.flowA.confirm();
    p.flowA.cancel();

    p.flowB.choose('public');
    p.flowB.confirm();

    expect(screens(p)).toEqual(['menu', 'waiting']);
  });

  test('a Private match: the host gets a link, the guest opens it, and both reach the Countdown; a third player finds it full', () => {
    const p = twoPlayers();
    p.flowA.choose('private');
    p.flowA.confirm();
    const host = p.flowA.state();
    expect(host).toMatchObject({ screen: 'waiting', kind: 'private' });
    const link = host.screen === 'waiting' ? host.inviteLink : undefined;
    expect(link).toMatch(/^https:\/\/typingame\.example\/#\/m\//);

    p.flowB.joinInvite(link!.split('/m/')[1]);
    p.flowB.confirm();
    expect(screens(p)).toEqual(['countdown', 'countdown']);

    const third = new ScreenFlow(p.backend.connect());
    third.joinInvite(link!.split('/m/')[1]);
    third.confirm();
    expect(third.state()).toMatchObject({ screen: 'error', reason: 'inviteFull' });
  });

  test('a link whose host has left is expired', () => {
    const p = twoPlayers();
    p.flowA.choose('private');
    p.flowA.confirm();
    const host = p.flowA.state();
    const code = host.screen === 'waiting' ? host.inviteLink!.split('/m/')[1] : '';
    p.flowA.cancel();

    p.flowB.joinInvite(code);
    p.flowB.confirm();

    expect(p.flowB.state()).toMatchObject({ screen: 'error', reason: 'inviteExpired' });
  });

  test("a Match ends for both, and both proposing a Rematch starts a new Countdown for both", () => {
    const p = twoPlayers();
    bothSearching(p);
    p.tick(5);
    p.tick(1.8);

    p.flowA.matchEnded('lost');
    p.flowB.matchEnded('won');
    expect(screens(p)).toEqual(['end', 'end']);

    p.flowA.proposeRematch();
    p.flowB.proposeRematch();
    expect(screens(p)).toEqual(['countdown', 'countdown']);
  });

  test('a proposal reaches the other player, who can decline it', () => {
    const p = twoPlayers();
    bothSearching(p);
    p.tick(5);
    p.tick(1.8);
    p.flowA.matchEnded('lost');
    p.flowB.matchEnded('won');

    p.flowA.proposeRematch();
    expect(p.flowB.state()).toMatchObject({ screen: 'end', rematch: { status: 'incoming' } });

    p.flowB.declineRematch();
    expect(p.flowA.state()).toMatchObject({ screen: 'end', rematch: { status: 'notice', notice: 'declined' } });
  });

  test('a request one side takes back disappears for the other; one nobody answers expires for both', () => {
    const p = twoPlayers();
    bothSearching(p);
    p.tick(5);
    p.tick(1.8);
    p.flowA.matchEnded('lost');
    p.flowB.matchEnded('won');

    p.flowA.proposeRematch();
    expect(p.flowB.state()).toMatchObject({ rematch: { status: 'incoming' } });
    p.flowA.cancelRematch();
    expect(p.flowB.state()).toMatchObject({ rematch: { status: 'available' } });

    p.flowA.proposeRematch();
    p.tick(10);
    expect(p.flowA.state()).toMatchObject({ rematch: { status: 'notice', notice: 'noAnswer' } });
    expect(p.flowB.state()).toMatchObject({ rematch: { status: 'notice', notice: 'tooLate' } });
  });

  test('if a player drops during the Match, the other waits 10 seconds and then wins', () => {
    const p = twoPlayers();
    bothSearching(p);
    p.tick(5);
    p.tick(1.8);

    p.backend.drop(p.a);
    p.flowB.update(9);
    expect(p.flowB.state().screen).toBe('match');
    p.flowB.update(1.1);
    expect(p.flowB.state()).toMatchObject({ screen: 'opponentLeft', during: 'match', youWin: true });
  });

  test('a player who leaves from the end screen tells the other, whose Rematch is gone', () => {
    const p = twoPlayers();
    bothSearching(p);
    p.tick(5);
    p.tick(1.8);
    p.flowA.matchEnded('lost');
    p.flowB.matchEnded('won');

    p.flowA.backToMenu();

    expect(p.flowB.state()).toMatchObject({ screen: 'end', rematch: { status: 'opponentLeft' } });
  });
});
