import { describe, expect, test } from 'vitest';
import { layersOn, startLayers, stepLayers } from './layers';

/** Play beats: `[intensity, beats]` runs, one after another; every 4th beat (from the first) starts a bar. */
function play(...runs: [number, number][]) {
  let s = startLayers();
  let beat = 0;
  for (const [v, n] of runs) for (let i = 0; i < n; i++, beat++) s = stepLayers(s, v, beat % 4 === 0);
  return layersOn(s);
}

describe('music layers', () => {
  test('layers join in order as intensity crosses their thresholds: pad, bass 0.18, kick 0.32, snare 0.45, hats 0.52, arp 0.6, lead 0.75', () => {
    expect(play([0.1, 1])).toEqual(['pad']);
    expect(play([0.5, 1])).toEqual(['pad', 'bass', 'kick', 'snare']);
    expect(play([0.8, 1])).toEqual(['pad', 'bass', 'kick', 'snare', 'hats', 'arp', 'lead']);
  });

  test('a layer just under its threshold (within 0.06) stays in', () => {
    expect(play([0.5, 1], [0.4, 40])).toContain('snare');
  });

  test('a layer well under its threshold leaves only after 2 bars', () => {
    // up on beat 0; low from beat 1; bar starts at beats 4 and 8
    expect(play([0.5, 1], [0.3, 7])).toContain('snare'); // beats 1-7: one bar start
    expect(play([0.5, 1], [0.3, 8])).not.toContain('snare'); // beat 8: the second
  });

  test('coming back up before the 2 bars are over keeps the layer and restarts the count', () => {
    // low over the bar start at 4, back up at beat 6, low again: bar starts at 8 count 1 only
    expect(play([0.5, 1], [0.3, 5], [0.5, 1], [0.3, 4])).toContain('snare');
  });
});
