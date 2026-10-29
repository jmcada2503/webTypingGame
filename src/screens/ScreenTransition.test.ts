import { describe, expect, test } from 'vitest';
import { DEFAULT_FLOW_CONFIG, type FlowState } from '../flow/types';
import { GLITCH, ScreenTransition, TV_OFF_ON, transitionFor, visualOf } from './ScreenTransition';

describe('ScreenTransition', () => {
  test('is idle before an effect starts', () => {
    const t = new ScreenTransition();
    expect(t.active).toBe(false);
    expect(t.level).toBe(0);
  });

  test('ramps the effect up, swaps the screen at the top, then ramps back down', () => {
    const t = new ScreenTransition();
    const swaps: string[] = [];
    t.start(GLITCH, 0, () => swaps.push('swap'));
    expect(t.active).toBe(true);
    expect(t.mode).toBe(GLITCH.mode);

    t.update(GLITCH.out / 2);
    expect(t.level).toBeCloseTo(0.25); // accelerates into the effect
    expect(swaps).toEqual([]);

    t.update(GLITCH.out / 2);
    expect(swaps).toEqual(['swap']);
    expect(t.level).toBeCloseTo(1);

    t.update(GLITCH.in / 2);
    expect(t.level).toBeCloseTo(0.25); // settles quickly

    t.update(GLITCH.in / 2);
    expect(t.active).toBe(false);
    expect(t.level).toBe(0);
  });

  test('a hold keeps the screen fully off between the effect and the way back', () => {
    const t = new ScreenTransition();
    t.start(TV_OFF_ON, 1, () => {});

    t.update(TV_OFF_ON.out);
    expect(t.level).toBeCloseTo(1);

    t.update(0.9);
    expect(t.level).toBeCloseTo(1); // still black
    expect(t.active).toBe(true);

    t.update(0.1);
    t.update(TV_OFF_ON.in / 2);
    expect(t.level).toBeLessThan(1); // the picture is coming back
  });

  test('input stays locked for the whole effect and is free again after', () => {
    const t = new ScreenTransition();
    t.start(TV_OFF_ON, 1, () => {});

    for (const dt of [0.3, 0.5, 0.5, 0.3, 0.1]) {
      t.update(dt);
      expect(t.active).toBe(true);
    }
    t.update(0.2);
    expect(t.active).toBe(false);
  });

  test('swaps once, even when one big frame step covers the whole effect', () => {
    const t = new ScreenTransition();
    let swaps = 0;
    t.start(GLITCH, 0, () => swaps++);

    t.update(10);

    expect(swaps).toBe(1);
    expect(t.active).toBe(false);
  });

  test('a second effect cannot start while one is running', () => {
    const t = new ScreenTransition();
    t.start(GLITCH, 0, () => {});
    expect(t.start(TV_OFF_ON, 1, () => {})).toBe(false);
    expect(t.mode).toBe(GLITCH.mode);
  });

  test('TV off, a 1 s black hold and TV on take exactly as long as the flow\'s starting gap', () => {
    expect(TV_OFF_ON.out + 1 + TV_OFF_ON.in).toBeCloseTo(DEFAULT_FLOW_CONFIG.startingSeconds);
  });
});

describe('which effect plays between two flow states', () => {
  const menu: FlowState = { screen: 'menu', serversResting: false, language: 'en' };
  const howto: FlowState = { screen: 'howto', kind: 'public', secondsLeft: 30 };
  const waiting: FlowState = { screen: 'waiting', kind: 'public', phase: 'searching' };
  const countdown: FlowState = { screen: 'countdown', mode: 'versus', secondsLeft: 5 };
  const starting: FlowState = { screen: 'starting', mode: 'versus' };
  const match: FlowState = { screen: 'match', mode: 'versus' };
  const end: FlowState = { screen: 'end', mode: 'practice', result: 'practiceOver' };

  test('the starting gap is drawn as the Match scene', () => {
    expect(visualOf(starting)).toBe('match');
    expect(visualOf(match)).toBe('match');
    expect(visualOf(countdown)).toBe('countdown');
  });

  test('menu navigation uses the glitch', () => {
    expect(transitionFor(menu, howto)).toEqual({ effect: GLITCH, hold: 0 });
    expect(transitionFor(howto, waiting)).toEqual({ effect: GLITCH, hold: 0 });
    expect(transitionFor(waiting, countdown)).toEqual({ effect: GLITCH, hold: 0 });
    expect(transitionFor(waiting, menu)).toEqual({ effect: GLITCH, hold: 0 });
    expect(transitionFor(match, end)).toEqual({ effect: GLITCH, hold: 0 });
    expect(transitionFor(end, countdown)).toEqual({ effect: GLITCH, hold: 0 });
  });

  test('after the Countdown, the TV switches off, stays black for 1 s, and switches on', () => {
    expect(transitionFor(countdown, starting)).toEqual({ effect: TV_OFF_ON, hold: 1 });
  });

  test('no effect while the screen stays the same, or the starting gap turns into the running Match', () => {
    expect(transitionFor(howto, { ...howto, secondsLeft: 12 })).toBeNull();
    expect(transitionFor(countdown, { ...countdown, secondsLeft: 3 })).toBeNull();
    expect(transitionFor(starting, match)).toBeNull();
  });
});
