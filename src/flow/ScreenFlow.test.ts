import { describe, expect, test } from 'vitest';
import { ScreenFlow } from './ScreenFlow';
import type { FlowNetwork, NetworkEvent } from './types';

/** A network the tests drive by hand: it records what the flow asks for and lets the test send events back. */
class RecordingNetwork implements FlowNetwork {
  calls: string[] = [];
  private handlers = new Set<(e: NetworkEvent) => void>();
  joinQueue(language: string) {
    this.calls.push(`joinQueue:${language}`);
  }
  createPrivate(language: string) {
    this.calls.push(`createPrivate:${language}`);
  }
  joinPrivate(code: string) {
    this.calls.push(`joinPrivate:${code}`);
  }
  leave() {
    this.calls.push('leave');
  }
  sendRematch(message: 'propose' | 'accept' | 'decline' | 'cancel') {
    this.calls.push(`rematch:${message}`);
  }
  onEvent(cb: (e: NetworkEvent) => void) {
    this.handlers.add(cb);
    return () => void this.handlers.delete(cb);
  }
  emit(event: NetworkEvent) {
    this.handlers.forEach((h) => h(event));
  }
}

const setup = () => {
  const network = new RecordingNetwork();
  const flow = new ScreenFlow(network);
  return { network, flow };
};
const screen = (flow: ScreenFlow) => flow.state().screen;

describe('Menu, how-to and waiting', () => {
  test('knows the chosen language on every screen, not only on the menu', () => {
    const { flow } = setup();
    expect(flow.language()).toBe('en');
    flow.setLanguage('es');
    flow.choose('public');
    flow.confirm();
    expect(screen(flow)).toBe('waiting');
    expect(flow.language()).toBe('es');
  });

  test('starts on the menu', () => {
    const { flow } = setup();
    expect(flow.state()).toMatchObject({ screen: 'menu', serversResting: false, language: 'en' });
  });

  test('choosing a Public match shows the how-to, then Enter starts the search', () => {
    const { flow, network } = setup();

    flow.choose('public');
    expect(flow.state()).toMatchObject({ screen: 'howto', kind: 'public', secondsLeft: 30 });
    expect(network.calls).toEqual([]);

    flow.confirm();
    expect(flow.state()).toMatchObject({ screen: 'waiting', kind: 'public', phase: 'searching' });
    expect(network.calls).toEqual(['joinQueue:en']);
  });

  test('the how-to counts down and starts the search by itself after 30 seconds', () => {
    const { flow, network } = setup();
    flow.choose('public');

    flow.update(10);
    expect(flow.state()).toMatchObject({ screen: 'howto', secondsLeft: 20 });

    flow.update(20);
    expect(screen(flow)).toBe('waiting');
    expect(network.calls).toEqual(['joinQueue:en']);
  });

  test('the search uses the chosen language', () => {
    const { flow, network } = setup();
    flow.setLanguage('es');

    flow.choose('public');
    flow.confirm();

    expect(network.calls).toEqual(['joinQueue:es']);
  });

  test('a Private match creates an Invite link and shows it while waiting', () => {
    const { flow, network } = setup();

    flow.choose('private');
    flow.confirm();
    expect(network.calls).toEqual(['createPrivate:en']);

    network.emit({ type: 'inviteCreated', link: 'https://typingame.example/#/m/K7Q2-9XPD' });
    expect(flow.state()).toMatchObject({ screen: 'waiting', kind: 'private', inviteLink: 'https://typingame.example/#/m/K7Q2-9XPD' });
  });

  test('cancelling the wait leaves quietly and returns to the menu', () => {
    const { flow, network } = setup();
    flow.choose('public');
    flow.confirm();

    flow.cancel();

    expect(screen(flow)).toBe('menu');
    expect(network.calls).toEqual(['joinQueue:en', 'leave']);
  });
});

/** A Public match, waiting for an opponent. */
const searching = () => {
  const ctx = setup();
  ctx.flow.choose('public');
  ctx.flow.confirm();
  return ctx;
};
/** Both connections confirmed: the Countdown is running. */
const counting = () => {
  const ctx = searching();
  ctx.network.emit({ type: 'matched' });
  ctx.network.emit({ type: 'connected' });
  return ctx;
};

describe('From the opponent to the Match', () => {
  test('when paired, the waiting screen switches to connecting', () => {
    const { flow, network } = searching();
    network.emit({ type: 'matched' });
    expect(flow.state()).toMatchObject({ screen: 'waiting', kind: 'public', phase: 'connecting' });
  });

  test('when both connections are confirmed, a 5 second Countdown starts', () => {
    const { flow } = counting();
    expect(flow.state()).toMatchObject({ screen: 'countdown', mode: 'versus', secondsLeft: 5 });

    flow.update(2);
    expect(flow.state()).toMatchObject({ screen: 'countdown', secondsLeft: 3 });
  });

  test('the Countdown ends in the starting gap, and the Match begins when the gap ends', () => {
    const { flow } = counting();

    flow.update(5);
    expect(flow.state()).toMatchObject({ screen: 'starting', mode: 'versus' });

    flow.update(1.7);
    expect(screen(flow)).toBe('starting'); // still in the gap: nobody can play yet

    flow.update(0.1);
    expect(flow.state()).toMatchObject({ screen: 'match', mode: 'versus' });
  });

  test('a connection not confirmed within 10 seconds fails with an error screen', () => {
    const { flow, network } = searching();
    network.emit({ type: 'matched' });

    flow.update(9);
    expect(screen(flow)).toBe('waiting');
    flow.update(1);

    expect(flow.state()).toMatchObject({ screen: 'error', reason: 'connectFailed', kind: 'public' });
    expect(network.calls).toContain('leave');
  });

  test('a connection that fails early (no network path, server error) shows the error at once', () => {
    const { flow, network } = searching();
    network.emit({ type: 'matched' });
    network.emit({ type: 'connectFailed' });
    expect(flow.state()).toMatchObject({ screen: 'error', reason: 'connectFailed', kind: 'public' });
    expect(network.calls).toContain('leave');
  });

  test('a failure while still searching shows the error too', () => {
    const { flow, network } = searching();
    network.emit({ type: 'connectFailed' });
    expect(flow.state()).toMatchObject({ screen: 'error', reason: 'connectFailed' });
  });

  test('a late connectFailed after the Countdown started changes nothing', () => {
    const { flow, network } = searching();
    network.emit({ type: 'matched' });
    network.emit({ type: 'connected' });
    network.emit({ type: 'connectFailed' });
    expect(screen(flow)).toBe('countdown');
  });

  test('after a connection error, Search again joins the queue again and Menu goes back', () => {
    const { flow, network } = searching();
    network.emit({ type: 'matched' });
    flow.update(10);

    flow.searchAgain();
    expect(flow.state()).toMatchObject({ screen: 'waiting', kind: 'public', phase: 'searching' });
    expect(network.calls.filter((c) => c === 'joinQueue:en')).toHaveLength(2);

    network.emit({ type: 'matched' });
    flow.update(10);
    flow.backToMenu();
    expect(screen(flow)).toBe('menu');
  });
});

/** A Public match that is running. */
const playing = () => {
  const ctx = counting();
  ctx.flow.update(5);
  ctx.flow.update(1.8);
  return ctx;
};

describe('Practice', () => {
  test('goes from the menu straight to the starting gap (no Countdown) and then the Match, never touching the network', () => {
    const { flow, network } = setup();

    flow.choose('practice');
    expect(flow.state()).toMatchObject({ screen: 'starting', mode: 'practice' });

    flow.update(1.7);
    expect(screen(flow)).toBe('starting');
    flow.update(0.1);
    expect(flow.state()).toMatchObject({ screen: 'match', mode: 'practice' });
    expect(network.calls).toEqual([]);
  });

  test('ends in a results screen, from where the player can play again or go back to the menu', () => {
    const { flow } = setup();
    flow.choose('practice');
    flow.update(1.8);

    flow.matchEnded('lost');
    expect(flow.state()).toMatchObject({ screen: 'end', mode: 'practice', result: 'practiceOver' });

    flow.playAgain();
    expect(flow.state()).toMatchObject({ screen: 'starting', mode: 'practice' });

    flow.update(1.8);
    flow.matchEnded('lost');
    flow.backToMenu();
    expect(screen(flow)).toBe('menu');
  });
});

describe('The end of a Match', () => {
  test.each(['won', 'lost', 'peace'] as const)('a %s Match ends on its own end screen', (result) => {
    const { flow } = playing();

    flow.matchEnded(result);

    expect(flow.state()).toMatchObject({ screen: 'end', mode: 'versus', result });
  });

  test('matchEnded only counts while a Match is running', () => {
    const { flow } = counting();
    flow.matchEnded('won');
    expect(screen(flow)).toBe('countdown');
  });

  test('from the end screen the player can search for a new opponent or go back to the menu, leaving the old one', () => {
    const { flow, network } = playing();
    flow.matchEnded('lost');

    flow.searchAgain();
    expect(flow.state()).toMatchObject({ screen: 'waiting', kind: 'public', phase: 'searching' });
    expect(network.calls.slice(-2)).toEqual(['leave', 'joinQueue:en']);

    const other = playing();
    other.flow.matchEnded('won');
    other.flow.backToMenu();
    expect(screen(other.flow)).toBe('menu');
    expect(other.network.calls.at(-1)).toBe('leave');
  });
});

describe('The opponent leaves', () => {
  test('while connecting, the player sees the Opponent left screen', () => {
    const { flow, network } = searching();
    network.emit({ type: 'matched' });

    network.emit({ type: 'opponentLeft' });

    expect(flow.state()).toEqual({ screen: 'opponentLeft', during: 'waiting', youWin: false, kind: 'public' });
    expect(network.calls.at(-1)).toBe('leave');
  });

  test('during the Countdown, and during the starting gap, it is the same screen', () => {
    const a = counting();
    a.network.emit({ type: 'opponentLeft' });
    expect(a.flow.state()).toMatchObject({ screen: 'opponentLeft', during: 'countdown', youWin: false });

    const b = counting();
    b.flow.update(5); // starting gap
    b.network.emit({ type: 'opponentDisconnected' });
    expect(b.flow.state()).toMatchObject({ screen: 'opponentLeft', during: 'countdown', youWin: false });
  });

  test('during the Match, a dropped connection gets 10 seconds to come back, then the player wins', () => {
    const { flow, network } = playing();

    network.emit({ type: 'opponentDisconnected' });
    flow.update(9.9);
    expect(screen(flow)).toBe('match');

    flow.update(0.2);
    expect(flow.state()).toEqual({ screen: 'opponentLeft', during: 'match', youWin: true, kind: 'public' });
  });

  test('a connection that comes back within the grace keeps the Match going', () => {
    const { flow, network } = playing();

    network.emit({ type: 'opponentDisconnected' });
    flow.update(3);
    network.emit({ type: 'opponentReconnected' });
    flow.update(10);

    expect(screen(flow)).toBe('match');
  });

  test('an opponent who leaves for good ends the Match at once, with a win', () => {
    const { flow, network } = playing();
    network.emit({ type: 'opponentLeft' });
    expect(flow.state()).toMatchObject({ screen: 'opponentLeft', during: 'match', youWin: true });
  });

  test('from the Opponent left screen a Public player can search again, and anyone can go back to the menu', () => {
    const { flow, network } = searching();
    network.emit({ type: 'matched' });
    network.emit({ type: 'opponentLeft' });

    flow.searchAgain();
    expect(flow.state()).toMatchObject({ screen: 'waiting', kind: 'public', phase: 'searching' });

    network.emit({ type: 'matched' });
    network.emit({ type: 'opponentLeft' });
    flow.backToMenu();
    expect(screen(flow)).toBe('menu');
  });

  test('a Private player has no new search: only the menu', () => {
    const { flow, network } = setup();
    flow.choose('private');
    flow.confirm();
    network.emit({ type: 'matched' });
    network.emit({ type: 'opponentLeft' });
    expect(flow.state()).toMatchObject({ screen: 'opponentLeft', kind: 'private' });

    flow.searchAgain();
    expect(screen(flow)).toBe('opponentLeft');
    flow.backToMenu();
    expect(screen(flow)).toBe('menu');
  });
});

/** A Public match that just ended with the given result. */
const ended = (result: 'won' | 'lost' | 'peace' = 'lost') => {
  const ctx = playing();
  ctx.flow.matchEnded(result);
  return ctx;
};
/** A Private match that just ended. */
const endedPrivate = () => {
  const ctx = setup();
  ctx.flow.choose('private');
  ctx.flow.confirm();
  ctx.network.emit({ type: 'matched' });
  ctx.network.emit({ type: 'connected' });
  ctx.flow.update(5);
  ctx.flow.update(1.8);
  ctx.flow.matchEnded('won');
  return ctx;
};
const rematchOf = (flow: ScreenFlow) => {
  const s = flow.state();
  return s.screen === 'end' && s.mode === 'versus' ? s.rematch : undefined;
};

describe('Rematch', () => {
  /** Rematch timing a test wants to shorten (the real values are 10 s window, 10 s answer, 2.4 s notice). */
  const endedWith = (config: ConstructorParameters<typeof ScreenFlow>[1] = {}, kind: 'public' | 'private' = 'public') => {
    const network = new RecordingNetwork();
    const flow = new ScreenFlow(network, config);
    flow.choose(kind);
    flow.confirm();
    network.emit({ type: 'matched' });
    network.emit({ type: 'connected' });
    flow.update(5);
    flow.update(1.8);
    flow.matchEnded('lost');
    return { flow, network };
  };

  describe('the window', () => {
    test('a Public match offers a Rematch for 10 seconds, then only a new search', () => {
      const { flow, network } = ended();
      expect(rematchOf(flow)).toEqual({ status: 'available', secondsLeft: 10 });

      flow.update(4);
      expect(rematchOf(flow)).toEqual({ status: 'available', secondsLeft: 6 });

      flow.update(6);
      expect(rematchOf(flow)).toEqual({ status: 'closed' });
      flow.proposeRematch();
      expect(network.calls).not.toContain('rematch:propose');
    });

    test('a Private match always offers the Rematch', () => {
      const { flow } = endedPrivate();
      flow.update(120);
      expect(rematchOf(flow)).toEqual({ status: 'available', secondsLeft: null });
    });

    test('a Rematch plays like a Match and offers a fresh Rematch window at its end', () => {
      const { flow, network } = ended();
      flow.proposeRematch();
      network.emit({ type: 'rematch', message: 'accept' });

      flow.update(5);
      flow.update(1.8);
      expect(flow.state()).toMatchObject({ screen: 'match', mode: 'versus' });

      flow.matchEnded('won');
      expect(rematchOf(flow)).toEqual({ status: 'available', secondsLeft: 10 });
    });
  });

  describe('proposing', () => {
    test('waits for the answer for 10 seconds; an accept starts a new Countdown at once', () => {
      const { flow, network } = ended();
      flow.update(3);

      flow.proposeRematch();
      expect(rematchOf(flow)).toEqual({ status: 'waiting', answerSecondsLeft: 10, secondsLeft: 7 });
      expect(network.calls.at(-1)).toBe('rematch:propose');

      network.emit({ type: 'rematch', message: 'accept' });
      expect(flow.state()).toMatchObject({ screen: 'countdown', mode: 'versus', secondsLeft: 5 });
    });

    test('the answer time counts down on its own, apart from the window', () => {
      const { flow } = ended();
      flow.proposeRematch();

      flow.update(4);

      expect(rematchOf(flow)).toEqual({ status: 'waiting', answerSecondsLeft: 6, secondsLeft: 6 });
    });

    test('no answer in time shows NO ANSWER for a moment, then the options again while the window is open', () => {
      const { flow } = endedWith({ rematchAnswerSeconds: 3 });
      flow.proposeRematch();

      flow.update(3);
      expect(rematchOf(flow)).toMatchObject({ status: 'notice', notice: 'noAnswer' });

      flow.update(2.4);
      expect(rematchOf(flow)).toEqual({ status: 'available', secondsLeft: 4.6 });
    });

    test('with the window gone by then, a request that expires leaves Rematch closed', () => {
      const { flow } = ended();
      flow.update(5);
      flow.proposeRematch();

      flow.update(10); // answer time over; the window ran out 5 s earlier
      expect(rematchOf(flow)).toMatchObject({ status: 'notice', notice: 'noAnswer' });

      flow.update(2.4);
      expect(rematchOf(flow)).toEqual({ status: 'closed' });
    });

    test('in a Private match the options come back after NO ANSWER, whatever the time', () => {
      const { flow } = endedPrivate();
      flow.proposeRematch();

      flow.update(10);
      flow.update(2.4);

      expect(rematchOf(flow)).toEqual({ status: 'available', secondsLeft: null });
    });

    test('cancelling a request tells the opponent and goes back to the options', () => {
      const { flow, network } = ended();
      flow.update(2);
      flow.proposeRematch();

      flow.cancelRematch();

      expect(network.calls.at(-1)).toBe('rematch:cancel');
      expect(rematchOf(flow)).toEqual({ status: 'available', secondsLeft: 8 });
    });

    test('cancelling after the window ran out leaves Rematch closed', () => {
      const { flow } = ended();
      flow.update(6);
      flow.proposeRematch();
      flow.update(5); // the window ends while waiting

      flow.cancelRematch();

      expect(rematchOf(flow)).toEqual({ status: 'closed' });
    });

    test('when both players propose, the Rematch starts right away', () => {
      const { flow, network } = ended();
      flow.proposeRematch();

      network.emit({ type: 'rematch', message: 'propose' });

      expect(screen(flow)).toBe('countdown');
    });
  });

  describe("the opponent's request", () => {
    test('arrives with its own 10 seconds to answer, and can be accepted, which starts the Countdown', () => {
      const { flow, network } = ended();
      flow.update(2);

      network.emit({ type: 'rematch', message: 'propose' });
      expect(rematchOf(flow)).toEqual({ status: 'incoming', answerSecondsLeft: 10, secondsLeft: 8 });

      flow.acceptRematch();
      expect(network.calls.at(-1)).toBe('rematch:accept');
      expect(screen(flow)).toBe('countdown');
    });

    test('proposing while the opponent already proposed counts as accepting', () => {
      const { flow, network } = ended();
      network.emit({ type: 'rematch', message: 'propose' });

      flow.proposeRematch();

      expect(network.calls.at(-1)).toBe('rematch:accept');
      expect(screen(flow)).toBe('countdown');
    });

    test('keeps its full answer time even after the 10 second window has run out', () => {
      const { flow, network } = ended();
      flow.update(9);
      network.emit({ type: 'rematch', message: 'propose' });

      flow.update(5);
      expect(rematchOf(flow)).toEqual({ status: 'incoming', answerSecondsLeft: 5, secondsLeft: 0 });

      flow.acceptRematch();
      expect(screen(flow)).toBe('countdown');
    });

    test('too late: after the answer time it shows TOO LATE for a moment, then the options (or closed)', () => {
      const { flow, network } = endedWith({ rematchAnswerSeconds: 3 });
      network.emit({ type: 'rematch', message: 'propose' });

      flow.update(3);
      expect(rematchOf(flow)).toMatchObject({ status: 'notice', notice: 'tooLate' });

      flow.update(2.4);
      expect(rematchOf(flow)).toEqual({ status: 'available', secondsLeft: 4.6 });

      const late = ended();
      late.flow.update(9);
      late.network.emit({ type: 'rematch', message: 'propose' });
      late.flow.update(10);
      late.flow.update(2.4);
      expect(rematchOf(late.flow)).toEqual({ status: 'closed' });
    });

    test('can be denied: the opponent is told, the player sees DECLINED, and in Public Rematch closes', () => {
      const { flow, network } = ended();
      network.emit({ type: 'rematch', message: 'propose' });

      flow.declineRematch();
      expect(network.calls.at(-1)).toBe('rematch:decline');
      expect(rematchOf(flow)).toMatchObject({ status: 'notice', notice: 'declined' });

      flow.update(2.4);
      expect(rematchOf(flow)).toEqual({ status: 'closed' });
    });

    test('a request the opponent cancels disappears, back to the options', () => {
      const { flow, network } = ended();
      flow.update(3);
      network.emit({ type: 'rematch', message: 'propose' });

      network.emit({ type: 'rematch', message: 'cancel' });

      expect(rematchOf(flow)).toEqual({ status: 'available', secondsLeft: 7 });
    });
  });

  describe('being declined', () => {
    test('says DECLINED for a moment; in Public Rematch is then closed, so only a new search remains', () => {
      const { flow, network } = ended();
      flow.proposeRematch();

      network.emit({ type: 'rematch', message: 'decline' });
      expect(rematchOf(flow)).toMatchObject({ status: 'notice', notice: 'declined' });

      flow.update(2.4);
      expect(rematchOf(flow)).toEqual({ status: 'closed' });
      flow.searchAgain();
      expect(screen(flow)).toBe('waiting');
    });

    test('in a Private match the options come back after DECLINED', () => {
      const { flow, network } = endedPrivate();
      flow.proposeRematch();

      network.emit({ type: 'rematch', message: 'decline' });
      flow.update(2.4);

      expect(rematchOf(flow)).toEqual({ status: 'available', secondsLeft: null });
    });

    test('a Private player who denies is back at the options too', () => {
      const { flow, network } = endedPrivate();
      network.emit({ type: 'rematch', message: 'propose' });

      flow.declineRematch();
      flow.update(2.4);

      expect(rematchOf(flow)).toEqual({ status: 'available', secondsLeft: null });
    });
  });

  describe('the opponent leaves', () => {
    test('while the end screen is up, the Rematch is gone', () => {
      const { flow, network } = ended();
      network.emit({ type: 'opponentLeft' });
      expect(rematchOf(flow)).toEqual({ status: 'opponentLeft' });

      const other = endedPrivate();
      other.network.emit({ type: 'opponentDisconnected' });
      expect(rematchOf(other.flow)).toEqual({ status: 'opponentLeft' });
    });

    test('with a request open, it is gone too', () => {
      const { flow, network } = ended();
      flow.proposeRematch();

      network.emit({ type: 'opponentLeft' });

      expect(rematchOf(flow)).toEqual({ status: 'opponentLeft' });
    });
  });
});

describe('Invite links', () => {
  test('opening an Invite link skips the menu: how-to first, then it joins that Private match', () => {
    const { flow, network } = setup();

    flow.joinInvite('K7Q2-9XPD');
    expect(flow.state()).toMatchObject({ screen: 'howto', kind: 'private' });
    expect(network.calls).toEqual([]);

    flow.confirm();
    expect(flow.state()).toMatchObject({ screen: 'waiting', kind: 'private', phase: 'searching' });
    expect(network.calls).toEqual(['joinPrivate:K7Q2-9XPD']);
  });

  test('the guest goes through the Countdown to the Match like anyone', () => {
    const { flow, network } = setup();
    flow.joinInvite('K7Q2-9XPD');
    flow.confirm();

    network.emit({ type: 'matched' });
    network.emit({ type: 'connected' });

    expect(flow.state()).toMatchObject({ screen: 'countdown', mode: 'versus', secondsLeft: 5 });
  });

  test.each([
    ['full', 'inviteFull'],
    ['expired', 'inviteExpired'],
  ] as const)('a %s link ends in an error screen with only the menu', (reason, errorReason) => {
    const { flow, network } = setup();
    flow.joinInvite('K7Q2-9XPD');
    flow.confirm();

    network.emit({ type: 'inviteInvalid', reason });

    expect(flow.state()).toMatchObject({ screen: 'error', reason: errorReason });
    flow.searchAgain();
    expect(screen(flow)).toBe('error');
    flow.backToMenu();
    expect(screen(flow)).toBe('menu');
  });
});

describe('Servers resting', () => {
  test('online matches are blocked on the menu, Practice still works', () => {
    const { flow } = setup();
    flow.setServersResting(true);
    expect(flow.state()).toMatchObject({ screen: 'menu', serversResting: true });

    flow.choose('public');
    flow.choose('private');
    expect(screen(flow)).toBe('menu');

    flow.choose('practice');
    expect(screen(flow)).toBe('starting');
  });

  test('the menu remembers it after coming back from anywhere', () => {
    const { flow } = setup();
    flow.setServersResting(true);
    flow.choose('practice');
    flow.update(1.8);
    flow.matchEnded('lost');
    flow.backToMenu();
    expect(flow.state()).toMatchObject({ screen: 'menu', serversResting: true });
  });

  test('a search or how-to still in progress goes back to the menu', () => {
    const a = setup();
    a.flow.choose('public');
    a.flow.setServersResting(true);
    expect(a.flow.state()).toMatchObject({ screen: 'menu', serversResting: true });

    const b = searching();
    b.flow.setServersResting(true);
    expect(b.flow.state()).toMatchObject({ screen: 'menu', serversResting: true });
    expect(b.network.calls.at(-1)).toBe('leave');
  });

  test('a Match, a Countdown and a Rematch already under way are not interrupted', () => {
    const a = counting();
    a.flow.setServersResting(true);
    expect(screen(a.flow)).toBe('countdown');

    const b = ended();
    b.flow.setServersResting(true);
    expect(b.flow.state()).toMatchObject({ screen: 'end' });
    b.flow.proposeRematch();
    b.network.emit({ type: 'rematch', message: 'accept' });
    expect(screen(b.flow)).toBe('countdown');
  });
});
