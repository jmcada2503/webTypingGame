import { describe, expect, test } from 'vitest';
import type { TypingInput } from '../input/TypingInput';
import { MatchEngine } from './MatchEngine';
import { MatchSession } from './MatchSession';
import type { MatchTransport, NetEvent } from './types';

/** A TypingInput the tests drive by hand: type(), then enter() like the hidden text field does. */
class FakeInput implements TypingInput {
  typedWord = '';
  enabled = true;
  private change = new Set<(w: string) => void>();
  private submit = new Set<(w: string) => void>();
  onChange(cb: (w: string) => void) {
    this.change.add(cb);
    return () => void this.change.delete(cb);
  }
  onSubmit(cb: (w: string) => void) {
    this.submit.add(cb);
    return () => void this.submit.delete(cb);
  }
  clear() {
    this.typedWord = '';
  }
  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) this.clear();
  }
  dispose() {}
  type(word: string) {
    this.typedWord = word;
    this.change.forEach((cb) => cb(word));
  }
  enter() {
    const word = this.typedWord;
    this.submit.forEach((cb) => cb(word));
    this.type('');
  }
}

class FakeTransport implements MatchTransport {
  sent: NetEvent[] = [];
  private handlers = new Set<(e: NetEvent) => void>();
  send(event: NetEvent) {
    this.sent.push(event);
  }
  onEvent(cb: (e: NetEvent) => void) {
    this.handlers.add(cb);
    return () => void this.handlers.delete(cb);
  }
  deliver(event: NetEvent) {
    this.handlers.forEach((h) => h(event));
  }
}

const config = { attackWords: { wordAt: (i: number) => ['rocket', 'meteor'][i % 2] }, bulletFlightSeconds: 8, shotFlightSeconds: 8 };
const versus = () => {
  const input = new FakeInput();
  const transport = new FakeTransport();
  const session = new MatchSession(new MatchEngine({ mode: 'versus', ...config }), transport);
  session.attachInput(input);
  session.start();
  return { input, transport, session };
};

describe('MatchSession', () => {
  test('shows what the player is typing', () => {
    const { input, session } = versus();
    input.type('roc');
    expect(session.state().typedWord).toBe('roc');
  });

  test('typing the Attack word and submitting fires a Shot over the transport', () => {
    const { input, transport, session } = versus();

    input.type('rocket');
    input.enter();
    const events = session.update(0.25);

    expect(events.map((e) => e.type)).toContain('attackFired');
    expect(transport.sent).toContainEqual({ type: 'shot', i: 0, t: 0, word: 'rocket' });
  });

  test("the opponent's events arrive through the transport", () => {
    const { transport, session } = versus();

    transport.deliver({ type: 'shot', i: 3, t: 5, word: 'comet' });
    session.update(0.25);

    expect(session.state().wordBullets.map((b) => b.word)).toEqual(['comet']);
  });

  test('is running after start and follows the Match status; the input locks when the Match ends', () => {
    const input = new FakeInput();
    const session = new MatchSession(new MatchEngine({ mode: 'practice', ...config }));
    session.attachInput(input);
    expect(session.status).toBe('idle');

    session.start();
    expect(session.status).toBe('running');

    ['a', 'b', 'c'].forEach((w) => session.spawnBullet(w));
    session.update(8);

    expect(session.status).toBe('lost');
    expect(input.enabled).toBe(false);
  });

  test('stops listening to the input and the transport after dispose', () => {
    const { input, transport, session } = versus();

    session.dispose();
    input.type('roc');
    transport.deliver({ type: 'shot', i: 1, t: 0, word: 'late' });

    expect(session.state().typedWord).toBe('');
    expect(session.state().wordBullets).toEqual([]);
  });
});
