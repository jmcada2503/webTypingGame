// PROTOTYPE (sound style, throwaway). Variant C: TERMINAL. CRT terminal / teletype / PC speaker.
// Only square beeps (1-bit), relay and teletype clicks, modem chirps, everything bit-crushed to ~11 kHz.
// Good = high clean beeps going up in fifths / octaves ("ACK"). Bad = the low warbling PC buzzer ("BZZT"). Neutral = mid beeps, relay clicks.
import type { SoundStyle } from './catalog';
import { arp, crush, loopable, mix, noise, tone, type Buf } from './synth';

const lofi = (b: Buf) => crush(b, 6, 4);
const beep = (f: number, dur = 0.06, vol = 0.2) => tone({ f, dur, vol, wave: 'square', curve: 0 });
/** The PC error buzzer: low square with a fast amplitude warble. */
const buzz = (f: number, dur: number, vol = 0.28) => tone({ f, dur, vol, wave: 'square', curve: 0.4, trem: { rate: 28, depth: 0.7 } });
const relay = (vol = 0.3) => mix([noise({ dur: 0.004, vol, curve: 2 })], [noise({ dur: 0.003, vol: vol * 0.6, curve: 2 }), 0.012]);
/** Teletype hammer: a click with a short metallic ring. */
const hammer = (f = 3200, vol = 0.22) => mix([noise({ dur: 0.003, vol, curve: 1 })], [tone({ f, dur: 0.006, vol: vol * 0.35, wave: 'square', curve: 3 })]);
/** Modem chirp: square hopping through `fs`, `step` seconds each. */
const modem = (fs: number[], step: number, vol = 0.14) => arp(step, fs.map((f) => (f === 0 ? noise({ dur: step, vol: vol * 0.8, curve: 0 }) : beep(f, step, vol))));
const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const variants = (n: number, make: (k: number) => Buf) => Array.from({ length: n }, (_, k) => make(k));

export const terminal: SoundStyle = {
  key: 'C',
  name: 'Terminal',
  idea: 'CRT terminal / teletype / PC speaker, 1-bit lo-fi. Good = clean high beeps rising in fifths (ACK); bad = the low warbling PC buzzer (BZZT).',
  sounds: {
    keyMatch: () => variants(6, (k) => lofi(hammer(2800 + k * 150, 0.2))),
    keyNoMatch: () => variants(3, (k) => lofi(buzz(105 + k * 6, 0.05, 0.22))),
    keyBackspace: () => lofi(relay(0.18)),
    wrongSubmit: () => lofi(buzz(90, 0.28, 0.3)),
    enemyFired: () => lofi(modem([2400, 2000, 1600, 1200], 0.02, 0.06)),
    closeWarning: () => lofi(arp(0.06, [beep(1000, 0.035, 0.18), beep(1000, 0.035, 0.18), beep(1000, 0.035, 0.18), beep(1000, 0.035, 0.18)])),
    lifeLost: () => lofi(mix([noise({ dur: 0.25, vol: 0.5, lp: 900 })], [buzz(70, 0.4, 0.32), 0.02], [relay(0.4)], [relay(0.35), 0.3])),
    lastLife: () => lofi(arp(0.16, [beep(800, 0.1, 0.22), beep(400, 0.1, 0.22), beep(800, 0.1, 0.22), beep(400, 0.1, 0.22), beep(800, 0.1, 0.22), beep(400, 0.14, 0.22)])),
    damageHum: () => loopable(lofi(mix([tone({ f: 60, dur: 2.05, vol: 0.07, wave: 'square', curve: 0 })], ...Array.from({ length: 7 }, (_, i): [Buf, number] => [relay(0.15), i * 0.28 + rnd(0, 0.1)])))),
    wordBulletDestroyed: () => lofi(mix([noise({ dur: 0.03, vol: 0.25, curve: 2 })], [arp(0.045, [beep(1500, 0.035, 0.18), beep(2250, 0.05, 0.18)]), 0.01])),
    attackFired: () => lofi(modem([800, 1200, 1600, 2000, 2400], 0.022, 0.16)),
    shotHit: () => lofi(mix([noise({ dur: 0.2, vol: 0.3, lp: 1500 })], [arp(0.05, [beep(1000, 0.04, 0.17), beep(1500, 0.04, 0.17), beep(2000, 0.07, 0.17)]), 0.06])),
    shotDefended: () => lofi(mix([arp(0.08, [beep(1500, 0.06, 0.18), beep(750, 0.1, 0.18)])], [relay(0.25), 0.18])),
    idleNudge: () => lofi(beep(1000, 0.07, 0.15)),
    peaceTick: () => lofi(relay(0.25)),
    menuMove: () => lofi(relay(0.18)),
    menuConfirm: () => lofi(beep(1000, 0.05, 0.16)),
    menuBack: () => lofi(beep(600, 0.05, 0.16)),
    sponsor: () => lofi(arp(0.08, [beep(1000, 0.06), beep(1333, 0.06), beep(2000, 0.1)])),
    copyLink: () => lofi(arp(0.025, [hammer(), hammer(3000), hammer(3400), hammer(2900), hammer(3300)])),
    language: () => lofi(mix([relay(0.18)], [beep(1200, 0.03, 0.12), 0.03])),
    glitch: () => lofi(modem(Array.from({ length: 14 }, () => (Math.random() < 0.3 ? 0 : rnd(300, 3500))), 0.021, 0.14)),
    tvOff: () => lofi(mix([tone({ f: 5000, f2: 80, dur: 0.33, vol: 0.12, wave: 'square', curve: 1 })], [noise({ dur: 0.02, vol: 0.4, curve: 2 }), 0.33])),
    tvOn: () => lofi(mix([noise({ dur: 0.02, vol: 0.4, curve: 2 })], [tone({ f: 60, dur: 0.45, vol: 0.18, wave: 'square', curve: 2, vib: { rate: 12, depth: 0.2 } }), 0.01], [beep(15000 / 4, 0.25, 0.03), 0.1])),
    opponentFound: () => lofi(modem([1200, 2400, 0, 1800, 0, 2100, 1300, 2400], 0.04, 0.14)),
    countdownTick: () => lofi(beep(800, 0.1, 0.2)),
    go: () => lofi(mix([beep(1600, 0.35, 0.18)], [beep(3200, 0.35, 0.08)])),
    scoreTick: () => lofi(hammer(3000, 0.18)),
    newBest: () => lofi(arp(0.09, [beep(1000, 0.07), beep(1250, 0.07), beep(1500, 0.07), beep(2000, 0.2)])),
    rematchProposed: () => lofi(arp(0.12, [beep(1000, 0.06, 0.16), beep(1000, 0.06, 0.16)])),
    rematchAccepted: () => lofi(arp(0.07, [beep(1000, 0.05), beep(1500, 0.05), beep(2000, 0.1)])),
    rematchDeclined: () => lofi(buzz(100, 0.22, 0.26)),
    opponentLeftWin: () => lofi(arp(0.08, [beep(750, 0.06), beep(1000, 0.06), beep(1500, 0.06), beep(2000, 0.16)])),
    errorSting: () => lofi(beep(500, 0.2, 0.18)),
    winEnding: () => lofi(mix([noise({ dur: 1.0, vol: 0.45, lp: [2500, 150] })], [buzz(55, 0.5, 0.2)], [arp(0.09, [beep(1000, 0.07), beep(1500, 0.07), beep(2000, 0.07), beep(3000, 0.25)]), 0.8])),
    loseEnding: () =>
      lofi(
        mix(
          // the Enemy ship looms: the buzzer drone swells and its warble speeds up
          [tone({ f: 55, dur: 3.5, vol: 0.2, wave: 'square', att: 2.8, curve: 0, trem: { rate: 6, depth: 0.6 } })],
          ...Array.from({ length: 10 }, (_, i): [Buf, number] => [relay(0.08 + i * 0.02), 0.4 + i * 0.3]),
          // it rushes over: a modem screech up and down
          [modem([400, 800, 1600, 3200, 0, 2400, 1200, 600, 300], 0.07, 0.18), 3.45],
          [noise({ dur: 0.6, vol: 0.35, lp: [3000, 300], curve: 1.5 }), 3.55],
        ),
      ),
    peaceEnding: () => lofi(mix([arp(0.45, [beep(1000, 0.12, 0.14), beep(890, 0.12, 0.13), beep(750, 0.12, 0.12), beep(667, 0.3, 0.11)])], ...Array.from({ length: 24 }, (_, i): [Buf, number] => [hammer(3000, 0.1), 2.2 + i * 0.07 + (i % 6 === 5 ? 0.15 : 0)]))),
    signalLost: () => lofi(mix([modem([1800, 0, 2400, 0, 1200, 0], 0.03, 0.16)], [beep(300, 0.25, 0.18), 0.2])),
    reconnecting: () => loopable(lofi(mix(...[0, 0.5, 1.0, 1.5].map((at, i): [Buf, number] => [modem(i % 2 ? [941, 1336] : [697, 1209], 0.12, 0.08), at]), [noise({ dur: 2.05, vol: 0.04, curve: 0 })]))),
    enemyBack: () => lofi(mix([modem([1200, 2400, 1800], 0.035, 0.12)], [arp(0.07, [beep(1500, 0.05), beep(2250, 0.09)]), 0.12])),
    resumeTick: () => lofi(beep(800, 0.1, 0.2)),
  },
};
