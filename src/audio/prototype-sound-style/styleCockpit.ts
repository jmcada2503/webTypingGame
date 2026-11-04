// PROTOTYPE (sound style, throwaway). Variant B: COCKPIT. Raw synthesis: analog sci-fi console.
// Sine / FM bells, filtered noise, sub-bass impacts, echo. Good = clean bright chimes rising with echo.
// Bad = low distorted thuds and detuned beating alarms (two close pitches), muffled. Neutral = soft sine blips.
import type { SoundStyle } from './catalog';
import { arp, drive, echo, gain, highpass, loopable, lowpass, mix, noise, note, tone, type Buf } from './synth';

const blip = (f: number, dur = 0.03, vol = 0.25) => tone({ f, dur, vol, curve: 2.5 });
const bell = (f: number, dur = 0.5, vol = 0.25) => tone({ f, dur, vol, fm: { ratio: 1.41, index: 2.2 }, curve: 3 });
/** Two close pitches beating against each other: the "wrong" sound of this style. */
const beat = (f: number, dur: number, vol = 0.25, wave: 'saw' | 'square' | 'sine' = 'saw') =>
  lowpass(mix([tone({ f, dur, vol, wave, curve: 1 })], [tone({ f: f * 1.06, dur, vol, wave, curve: 1 })]), 1800);
const thud = (f = 60, dur = 0.4, vol = 0.6) => tone({ f, f2: f / 2, dur, vol, curve: 2.5 });
const click = (vol = 0.25, hp = 2500) => noise({ dur: 0.006, vol, hp, curve: 3 });
const space = (b: Buf, fb = 0.3) => echo(b, 0.11, fb, 4);
const variants = (n: number, make: (k: number) => Buf) => Array.from({ length: n }, (_, k) => make(k));

export const cockpit: SoundStyle = {
  key: 'B',
  name: 'Cockpit',
  idea: 'Analog sci-fi console: switch clicks, sine/FM bells, sub-bass hits, radio static, echo. Good = clean rising chimes; bad = low detuned beating + distortion.',
  sounds: {
    keyMatch: () => variants(5, (k) => mix([click(0.22, 2000 + k * 300)], [blip(2100 + k * 120, 0.012, 0.08)])),
    keyNoMatch: () => variants(3, (k) => mix([lowpass(noise({ dur: 0.03, vol: 0.4, curve: 3 }), 700)], [lowpass(mix([tone({ f: 120 + k * 4, dur: 0.07, vol: 0.35, curve: 2 })], [tone({ f: 127 + k * 4, dur: 0.07, vol: 0.35, curve: 2 })]), 600)])),
    keyBackspace: () => mix([click(0.12, 1500)], [tone({ f: 900, f2: 650, dur: 0.02, vol: 0.12 })]),
    wrongSubmit: () => mix([beat(140, 0.12, 0.3, 'square')], [beat(110, 0.16, 0.32, 'square'), 0.13]),
    enemyFired: () => mix([noise({ dur: 0.45, vol: 0.16, lp: [900, 150], att: 0.02 })], [tone({ f: 110, f2: 70, dur: 0.35, vol: 0.18 })]),
    closeWarning: () => space(mix([tone({ f: 1000, f2: 1450, dur: 0.14, vol: 0.2, curve: 1.5 })], [tone({ f: 1060, f2: 1540, dur: 0.14, vol: 0.2, curve: 1.5 })]), 0.25),
    lifeLost: () =>
      drive(mix([thud(65, 0.7, 0.7)], [noise({ dur: 0.45, vol: 0.4, lp: 1600 })], [tone({ f: 523, dur: 0.8, vol: 0.08, curve: 3 })], [tone({ f: 811, dur: 0.6, vol: 0.07, curve: 3 })], [tone({ f: 1234, dur: 0.4, vol: 0.06, curve: 3 })]), 2.5),
    lastLife: () => arp(0.24, [beat(440, 0.22, 0.22), beat(370, 0.22, 0.22), beat(440, 0.22, 0.22), beat(370, 0.3, 0.22)]),
    damageHum: () => loopable(mix([lowpass(tone({ f: 50, dur: 2.05, vol: 0.12, wave: 'saw', curve: 0 }), 300)], ...Array.from({ length: 9 }, (_, i): [Buf, number] => [highpass(noise({ dur: 0.01 + Math.random() * 0.02, vol: 0.25, curve: 2 }), 1200), i * 0.22 + Math.random() * 0.15]))),
    wordBulletDestroyed: () => space(mix([bell(1800, 0.35, 0.18)], [highpass(noise({ dur: 0.12, vol: 0.25, curve: 3 }), 2500)], [blip(2700, 0.08, 0.08), 0.03]), 0.2),
    attackFired: () => space(mix([tone({ f: 300, f2: 1800, dur: 0.22, vol: 0.2, curve: 1.2 })], [noise({ dur: 0.25, vol: 0.12, hp: 1500, curve: 1.5 })]), 0.25),
    shotHit: () => space(mix([noise({ dur: 0.5, vol: 0.18, lp: [1200, 200] })], [bell(note(19), 0.5, 0.14), 0.04], [bell(note(24), 0.6, 0.12), 0.09]), 0.3),
    shotDefended: () => lowpass(mix([tone({ f: 900, f2: 200, dur: 0.3, vol: 0.22, curve: 1 })], [tone({ f: 950, f2: 212, dur: 0.3, vol: 0.2, curve: 1 })], [thud(80, 0.2, 0.3), 0.18]), 2000),
    idleNudge: () => space(blip(1500, 0.06, 0.15), 0.35),
    peaceTick: () => mix([blip(2000, 0.006, 0.18)], [click(0.08)]),
    menuMove: () => blip(1200, 0.018, 0.14),
    menuConfirm: () => arp(0.05, [blip(880, 0.04, 0.16), blip(1320, 0.07, 0.16)]),
    menuBack: () => arp(0.05, [blip(1320, 0.04, 0.16), blip(880, 0.07, 0.16)]),
    sponsor: () => space(mix([bell(note(15), 0.6, 0.1)], [bell(note(19), 0.6, 0.1), 0.06], [bell(note(22), 0.7, 0.1), 0.12]), 0.25),
    copyLink: () => arp(0.035, [click(0.25), click(0.2), blip(1700, 0.04, 0.12)]),
    language: () => tone({ f: 1000, f2: 1150, dur: 0.05, vol: 0.14 }),
    glitch: () =>
      mix(...Array.from({ length: 14 }, (_, i): [Buf, number] => [Math.random() < 0.5 ? highpass(noise({ dur: 0.02, vol: 0.2, curve: 0.5 }), 800 + Math.random() * 3000) : tone({ f: 200 + Math.random() * 2500, dur: 0.02, vol: 0.1, fm: { ratio: 3.7, index: 6 }, curve: 0.5 }), i * 0.021])),
    tvOff: () => mix([tone({ f: 7000, f2: 60, dur: 0.35, vol: 0.06, curve: 1 })], [thud(70, 0.2, 0.35), 0.28], [noise({ dur: 0.35, vol: 0.06, hp: 3000, curve: 2 })]),
    tvOn: () => mix([thud(55, 0.5, 0.45)], [tone({ f: 50, dur: 0.5, vol: 0.08, wave: 'saw', curve: 2 })], [tone({ f: 2000, f2: 8000, dur: 0.45, vol: 0.03, curve: 1 }), 0.05]),
    opponentFound: () => space(arp(0.1, [blip(1200, 0.08, 0.18), blip(1600, 0.14, 0.18)]), 0.3),
    countdownTick: () => space(tone({ f: 880, dur: 0.16, vol: 0.2, curve: 3 }), 0.25),
    go: () => drive(mix([lowpass(mix([tone({ f: note(3), dur: 0.7, vol: 0.18, wave: 'saw', curve: 1.5 })], [tone({ f: note(10), dur: 0.7, vol: 0.15, wave: 'saw', curve: 1.5 })], [tone({ f: note(15), dur: 0.7, vol: 0.13, wave: 'saw', curve: 1.5 })]), 3500)], [thud(55, 0.4, 0.5)]), 1.5),
    scoreTick: () => blip(3000, 0.008, 0.1),
    newBest: () => space(arp(0.08, [bell(note(15), 0.4, 0.12), bell(note(19), 0.4, 0.12), bell(note(22), 0.4, 0.12), bell(note(27), 0.8, 0.14)]), 0.3),
    rematchProposed: () => arp(0.12, [blip(1000, 0.06, 0.16), blip(1000, 0.06, 0.16)]),
    rematchAccepted: () => space(arp(0.07, [bell(note(10), 0.3, 0.12), bell(note(15), 0.3, 0.12), bell(note(22), 0.5, 0.12)]), 0.25),
    rematchDeclined: () => arp(0.16, [beat(300, 0.14, 0.2), beat(220, 0.22, 0.2)]),
    opponentLeftWin: () => space(mix([bell(note(10), 0.6, 0.1)], [bell(note(15), 0.6, 0.1), 0.06], [bell(note(19), 0.8, 0.1), 0.12]), 0.3),
    errorSting: () => lowpass(tone({ f: 400, dur: 0.22, vol: 0.2, curve: 1.5 }), 1500),
    winEnding: () => drive(mix([thud(50, 1.5, 0.75)], [noise({ dur: 1.5, vol: 0.5, lp: [3000, 120], att: 0.01 })], [space(mix([bell(note(15), 0.8, 0.1)], [bell(note(19), 0.8, 0.1), 0.08], [bell(note(22), 0.9, 0.1), 0.16], [bell(note(27), 1.2, 0.12), 0.24]), 0.35), 0.9]), 1.6),
    loseEnding: () =>
      mix(
        // the Enemy ship looms: rumble swelling, engine whine rising as it gets close
        [noise({ dur: 3.6, vol: 0.35, lp: [120, 400], swell: true, curve: 1.5 })],
        [tone({ f: 38, dur: 3.6, vol: 0.3, curve: 0, att: 2.5 })],
        [tone({ f: 180, f2: 420, dur: 3.5, vol: 0.06, wave: 'saw', att: 2, curve: 0 })],
        // it rushes over and behind: doppler drop and a big whoosh
        [tone({ f: 520, f2: 110, dur: 0.9, vol: 0.18, wave: 'saw', curve: 1.5 }), 3.5],
        [noise({ dur: 1.1, vol: 0.45, lp: [3500, 200], att: 0.15, curve: 1.5 }), 3.4],
        [thud(45, 0.8, 0.5), 3.6],
      ),
    peaceEnding: () => mix([noise({ dur: 2.5, vol: 0.12, hp: 1500, lp: [6000, 800], att: 0.3, curve: 2 })], [tone({ f: note(3), dur: 4, vol: 0.06, att: 1.2, curve: 1.5 }), 0.3], [tone({ f: note(10), dur: 4, vol: 0.05, att: 1.4, curve: 1.5 }), 0.5], [tone({ f: note(15), dur: 4, vol: 0.05, att: 1.6, curve: 1.5 }), 0.7]),
    signalLost: () => mix([crushStatic(0.35, 0.3)], [tone({ f: 1000, f2: 300, dur: 0.4, vol: 0.12, curve: 1.5, vib: { rate: 30, depth: 0.04 } }), 0.1]),
    reconnecting: () => loopable(mix([noise({ dur: 2.05, vol: 0.09, hp: 600, lp: 3500, curve: 0, att: 0.01 })], ...Array.from({ length: 4 }, (_, i): [Buf, number] => [tone({ f: 600 + i * 150, f2: 900 + i * 150, dur: 0.3, vol: 0.03, curve: 1 }), i * 0.5]))),
    enemyBack: () => mix([crushStatic(0.12, 0.15)], [space(arp(0.09, [blip(1200, 0.07, 0.18), blip(1800, 0.12, 0.18)]), 0.25), 0.1]),
    resumeTick: () => space(tone({ f: 880, dur: 0.16, vol: 0.2, curve: 3 }), 0.25),
  },
};

/** Radio static burst: gated band-passed noise. */
function crushStatic(dur: number, vol: number): Buf {
  const b = highpass(noise({ dur, vol, lp: 4000, curve: 1 }), 500);
  for (let i = 0; i < b.length; i++) if (Math.floor(i / 300) % 3 === 0) b[i] *= 0.15;
  return gain(b, 1);
}
