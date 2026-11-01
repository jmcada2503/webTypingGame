# Research: Adaptive music in the browser at $0

Ticket: #151 (part of map #149). Feeds the prototype #155 (Adaptive music) and the build #156 (Audio engine).
Date: 2026-11-01.

## Question

How can Typewing play adaptive music (intensity follows game state: Pace gap, Lives, Word bullets in flight) in the browser, with $0 budget and a licence that allows shipping in a public web game? Covers techniques, sources, beat-synced transitions, switching menu / Match / ending music, CPU and memory next to the WebGL ASCII render, download size, and Safari quirks.

## Recommendation

**Compose the music in code: generative layers with Tone.js on one Transport, sharing the game's single AudioContext.**

- **Vertical layers** (for example pad, bass, drums, arp, lead) loop on a shared clock. A pure `intensity(GameViewState) → 0..1` function sets each layer's gain. It also drives values a fixed audio file cannot change: low-pass cutoff, note density, small tempo nudges, drum fills.
- **Horizontal states** for screens: menu loop, then a Countdown riser timed to the Countdown, then the Match layers, then an ending stinger (win / lose / Peace), then the end-screen loop. Every change is quantized to the next bar (or beat) on the audio clock.
- **Smoothing:** the intensity rule has hysteresis: it rises fast, falls slowly, and holds each level for at least about 2 bars. It is pure logic, so it is unit-tested (TDD, as the map asks).
- **Lazy load:** `import('tone')` on the first keypress, so the initial game bundle does not grow.
- **Fallback:** if the prototype shows that code-composed music sounds too thin, use CC0 loops (Abstraction / Tallbeard bundle, see below) for the menu and end screens only (horizontal re-sequencing plus a filter). Keep the code layers for the Match, where adaptivity matters.

Why this option:

- **No licence risk.** Everything is our own code.
- **Almost nothing to download.** Tone.js is about 79 KB gzipped (full build, measured), and there are no audio files.
- **Little decoded-audio memory.** Stems would need tens of MB (numbers below).
- **Fits the retro ASCII / CRT look.** Synthwave or chiptune comes naturally from oscillators.
- **Continuous intensity, not 3 to 4 fixed steps.** Pace gap and Word bullets in flight change all the time, and synthesis follows them smoothly.

Main cost: someone has to write music in code, and the ceiling depends on that skill. Simple synths can sound thin. The prototype (#155) judges this by ear.

## Techniques

| Technique | How | Pros | Cons |
|---|---|---|---|
| **Vertical layering (stems)** | N synced loops start at the same audio-clock `when`; gains follow intensity | Smooth and musical, the industry standard (FMOD and Wwise do this) | Needs stems (rare among free assets); decoded memory grows with N × length; intensity limited to the authored layers |
| **Horizontal re-sequencing** | Pick the next segment or loop at a bar or phrase boundary (calm → tense → climax) | Works with full-mix loops (CC0 packs are full mixes); clear changes | Steps, not continuous; reacts only at boundaries (1 bar = 2 s at 120 BPM); needs matching key and tempo between segments |
| **Generative / procedural (code)** | Synths plus a scheduler create notes live; parameters follow state | Continuous control (density, filter, tempo, harmony); 0 bytes of audio; no licence questions | Composition effort; quality ceiling; audio-thread CPU on weak phones if voices are not capped |
| **Parameter modulation on a fixed track** | Low-pass filter, gain, playback rate on one loop | Cheap, works on any source | Weak by itself (a filter sweep is not "more intense music"); changing playbackRate also shifts pitch |
| **Stingers** | One-shot musical hits on events (life lost, Shot destroyed, ending), quantized to the beat | Strong feedback, cheap | Overlaps with the SFX design (#152 / #154) |
| **Pre-render code to buffers** | Compose in code, render the stems once with `OfflineAudioContext` at load, then play them as layers | No live-synthesis CPU during a Match | Decode-sized memory (same as stems), load time, loses live variation |
| **MIDI + small sampler** | `@tonejs/midi` plus a few samples | Write music in any free DAW or tracker | Needs samples (licence again); a middle ground with no clear win |

The recommendation combines vertical and generative for the Match, horizontal for screen changes, and stingers for endings.

## Sources: free and shippable vs composing in code

Licences checked on primary pages (2026-11-01):

| Source | Licence (primary) | Fit |
|---|---|---|
| **Abstraction / Tallbeard "Music Loop Bundle"** (tallbeard.itch.io/music-loop-bundle) | CC0: "waived all copyright and related or neighboring rights… any commercial or non-commercial project". Credit optional ("Abstraction") | Over 200 songs, seamless loops, ambient / chiptune / upbeat. Full mixes, no stems mentioned. **Best fallback for menu and end screens** |
| **TechnoByte** (yuekistimky.itch.io/technobyte) | "All tracks are CC0 (Public Domain)". Polite request: no NFTs, AI training or unedited resale | 5 loops, dance / 8-bit / club, WAV and OGG. No stems |
| **Juhani Junkala, "4 Chiptunes (Adventure)"** (OpenGameArt) | CC0 | 4 seamless chiptune loops, OGG 8 MB. No stems |
| **Kenney "Music Jingles"** | CC0 | 85 short jingles (2014). Good for ending stingers, not for loops |
| OpenGameArt CC0 music collections, Freesound (CC0 filter) | Per item, CC0 when filtered | Mixed quality; check each item; Freesound is mostly loops and one-shots |
| Pixabay Music | Pixabay Content License (not CC0): free, no attribution, no "standalone" redistribution | Probably fine inside a game, but the terms do not mention games or Content ID. **Avoid if CC0 is available** |
| Incompetech (Kevin MacLeod) | CC BY (credit required) | Allowed at $0 with a credit line, but full mixes, no stems, and a recognizable library sound |
| SubspaceAudio "400 Indie Game Music Loops" | CC BY 4.0, **$79.90** | Breaks the $0 budget (a few tracks are CC0 on OpenGameArt) |
| FreePD | Public domain, but the site says it is **closed** | Not dependable |
| **Suno and other AI generators (free tier)** | Suno Basic: **Suno keeps ownership**, use is non-commercial only, and paying later does not change that | **Not shippable** in a public game; avoid |
| **BeepBox** (free web tool) | "Does not claim ownership over songs created with it"; code MIT | Free way to compose by hand. Mute channels and export each one to build our own stems, or play its MIT synth in-game. Good if someone prefers composing in a tracker |
| ZzFXM | MIT, tiny | Renders a whole song to a buffer before playing, not live. Fine for jingles, poor for adaptive music |
| Strudel | **AGPL-3.0** | Shipping it would bind the game to the AGPL. Avoid |
| **Tone.js** | MIT, v15.1.22 | The recommended engine |

**Key finding:** no CC0 or $0 source with **adaptive stems** for synthwave or electronic music was found. Free loops are full mixes, so with files we get horizontal plus filter only, unless we author stems ourselves (in code, or in BeepBox).

## Beat-synced changes without glitches

- **One clock.** Schedule everything on `AudioContext.currentTime`, never with `setTimeout`. Use the lookahead scheduler from "A Tale of Two Clocks" (web.dev): a timer every ~25 ms queues notes ~100 ms ahead. If a WebGL frame hitch delays the timer by 50 ms, playback does not drop, because notes are already queued on the audio thread. Tone.js does this for you (Transport, `lookAhead`, default about 0.1 s). Its ticker runs in a Worker, so throttled `requestAnimationFrame` or main-thread timers do not stall it.
- **Quantize changes.** For a screen or state change: `nextBar = start + ceil((now - start) / barLen) * barLen` (in Tone: `"@1m"` or `Transport.nextSubdivision("1m")`). Start new layers or segments at exactly that time, and fade the old ones from the same point.
- **No clicks:**
  - Fade gains with `setTargetAtTime` (time constant ~0.05–0.5 s), or anchor with `setValueAtTime(currentValue, t)` before `linearRampToValueAtTime`.
  - Never jump a gain, and never `stop()` a sounding source without a short fade first.
  - Use an equal-power crossfade when swapping whole tracks.
  - Synth envelopes need an attack and release of at least ~5 ms.
  - Avoid `cancelAndHoldAtTime`: Firefox does not support it.
- **Sample-locked stems.** Start every layer with the same `when`. `AudioBufferSourceNode` with `loop = true` stays sample-aligned forever. If the layers are files: MP3 and AAC add encoder padding (silent gaps at the loop seam). Use Ogg or Opus, or WAV, or set `loopStart` / `loopEnd` to the exact loop length.
- **Hysteresis.** Without it, the intensity rule makes layers flap in and out as the Pace gap wobbles. Smooth the raw value (for example an exponential moving average), use separate rise and fall rates, and hold each step for at least 2 bars. Test this pure rule with TDD.
- **Countdown.** Choose a tempo where Countdown seconds land on beats (120 BPM gives 2 beats per second). The riser then ends exactly on GO, and the Match layers start on the downbeat.

## Switching menu / Match / ending music

A small music state machine (`menu → countdown → match(intensity) → ending(win|lose|peace) → endScreen → menu`) that the screen host drives (`docs/screens.md`):

- **Same tempo and key** across states, so every change is a bar-quantized crossfade on one Transport and never a hard cut.
- **Endings:** schedule a stinger on the next beat (short wait), duck the Match layers over ~1 beat, then start the end-screen loop on the bar after the stinger.
- **Link effects and quick screen hops:** do not restart the music. Keep the menu loop running across menu sub-screens. Only states that matter (Countdown, Match, ending) change it.
- **Practice** reuses the Match layers. Intensity comes from Word bullets in flight and Lives only, because Practice has no opponent Pace gap.

## CPU and memory next to the WebGL render

- **Threads:** Web Audio renders on its own real-time audio thread. On the main thread (shared with WebGL), music only costs the scheduler tick: a few small JS calls every 25 ms, negligible next to a frame.
- **Audio-thread overload** shows as crackles, not lower FPS. Keep it safe:
  - Cap polyphony: about 8–16 voices total for music is plenty.
  - Avoid `ConvolverNode` reverb and HRTF panners. Tone's wiki names them the heaviest nodes. Use a feedback delay or a short algorithmic reverb.
  - Consider `latencyHint: "playback"` only if crackles appear. Keystroke SFX share the context and need `"interactive"` (the default) for low latency, so keep the default.
- **Decoded audio memory (the main cost of stems).** `decodeAudioData` stores 32-bit float PCM at the context rate (usually 48 kHz): **~384 KB/s stereo ≈ 23 MB per minute**.
  - 4 stems × 64 s loop ≈ **98 MB**. Menu and end loops add more.
  - Tone's wiki warns that mobile browsers can crash while decoding many or large files.
  - Generative synthesis needs ~0 MB.
  - With files: use mono where possible, short loops (8 bars ≈ 16 s ≈ 6 MB stereo), and decode lazily per state.
- **Garbage:** Tone creates small objects per event. That is fine at music note rates, but do not create nodes per frame.
- **iOS frame throttling (reported, verify):** Babylon.js found that a looping silent `<audio>` element (the old unlock hack for the mute switch) made iOS Safari show the audio indicator and throttle the page to **30 FPS**. Do not use that hack; use `navigator.audioSession` (see Safari quirks). Check FPS on an iPhone in the prototype with music running.

## Download size

| Approach | Size |
|---|---|
| Tone.js (full UMD build v15.1.22) | 345 KB min, **~79 KB gzip** (measured). Tree-shaken ESM is likely smaller; measure with `vite build`. Lazy-loaded after the first key |
| Raw Web Audio scheduler + synths | A few KB of our own code |
| Stems (Opus ~96 kbps) | ~0.7 MB per stereo minute per stem → 4 stems × 1 min + menu + end ≈ **4–6 MB** |
| Ogg Vorbis ~128 kbps | ~1 MB per minute per stem |
| CC0 full-mix loops for menu and end only | ~1–2 MB |

## Safari quirks

1. **Autoplay / unlock:** the `AudioContext` starts `suspended`. Call `resume()` (or `Tone.start()`) inside a user-gesture handler. In the HTML spec, `keydown` counts as user activation (except Escape), which fits "starts on the first keypress". Test in Safari specifically.
2. **iOS mute switch:** by default Web Audio is muted when the ringer switch is off. Setting `navigator.audioSession.type = "playback"` (Safari only, iOS 17+; feature-detect) plays through the switch. **Trade-off:** the spec says `playback` does not mix and may pause other apps' audio (the player's Spotify). `ambient` mixes and respects the switch. Probably default to `ambient` (respect the user), and decide in the settings ticket.
3. **`interrupted` state:** after a tab switch, screen lock or call, the context goes to `interrupted` (iOS). `resume()` may need a new gesture, and some WebKit bugs leave it stuck. Listen to `statechange` and `visibilitychange`, and resume on the next keydown.
4. **Codecs:** caniuse marks Ogg Vorbis as fully supported only from Safari **18.4** (macOS and iOS); earlier versions are partial. Opus is full on iOS 18.4+ and partial on macOS. With files, ship AAC/m4a as a fallback (and handle its loop padding), or require 18.4+. Generative music has no codec problem.
5. **Memory:** iOS kills tabs that hold a lot of decoded audio (see the numbers above). Generative music avoids this.
6. **Output device changes** (AirPods connect) can change the hardware sample rate. Native nodes handle this; avoid assuming 44.1 kHz in code.

## Fit with the codebase

- The engine already exposes `state()` → `GameViewState` per frame (`docs/match-engine.md`). The music intensity rule is a pure function of it plus `dt`, so it is easy to unit-test.
- One `AudioContext` for SFX and music (#156). Tone can adopt an existing context with `Tone.setContext(...)`. The audio engine owns the master, SFX and music gain buses (from the map's controls). Tone's output connects into the music bus.
- `/sandbox/` page for listening to layers and an intensity slider: a natural home for the #155 prototype.

## Suggested shape for prototype #155

- **Variant A (recommended):** Tone.js generative. 4–5 layers plus filter and density, driven by intensity. An intensity slider in `/sandbox/`, then wired into a live Match and Practice.
- **Variant B (only if A sounds thin):** a CC0 Abstraction loop with horizontal sections plus a low-pass filter driven by intensity, and a code-synth percussion layer added on top.
- **Drivers to try by ear:** Pace gap (signed: winning vs losing could change harmony or mode, not only loudness), Lives left, Word bullets in flight (nearest arrival time), and Match time.

## Open uncertainties

- Whether code-composed music sounds good enough: the prototype judges by ear.
- Tone.js tree-shaken size in our Vite build: measure it.
- Safari `keydown` unlock and `audioSession` behaviour on current iOS (26.x): test on a device.
- The iOS 30 FPS throttle with Web Audio alone (without an `<audio>` element): verify on a device.

## Sources

- Tone.js repo, MIT licence: https://github.com/Tonejs/Tone.js ; Performance wiki: https://github.com/Tonejs/Tone.js/wiki/Performance ; npm `tone` 15.1.22 (size measured from jsDelivr `build/Tone.js`)
- A Tale of Two Clocks (lookahead scheduling): https://web.dev/articles/audio-scheduling
- MDN BaseAudioContext.state (`interrupted`): https://developer.mozilla.org/docs/Web/API/BaseAudioContext/state
- WebKit bug 237322 (Web Audio muted by the ringer switch): https://bugs.webkit.org/show_bug.cgi?id=237322 ; bug 273511 (stuck on interrupted): https://bugs.webkit.org/show_bug.cgi?id=273511
- Audio Session API draft: https://w3c.github.io/audio-session/
- Babylon.js forum, iOS 30 FPS with silent `<audio>`: https://forum.babylonjs.com/t/audio-engine-tanking-fps-in-ios-safari/63232
- caniuse Ogg Vorbis: https://caniuse.com/ogg-vorbis ; Opus: https://caniuse.com/opus
- Abstraction / Tallbeard loop bundle (CC0): https://tallbeard.itch.io/music-loop-bundle
- TechnoByte (CC0): https://yuekistimky.itch.io/technobyte
- Juhani Junkala, 4 Chiptunes (CC0): https://opengameart.org/content/4-chiptunes-adventure
- Kenney Music Jingles (CC0): https://kenney.nl/assets/music-jingles
- Pixabay Content License: https://pixabay.com/service/license-summary/
- Incompetech licences: https://incompetech.com/music/royalty-free/licenses/
- SubspaceAudio loops (CC BY 4.0, paid): https://subspaceaudio.itch.io/indie-game-music-loops
- FreePD (closed): https://freepd.com/
- Suno ownership on the free plan: https://help.suno.com/en/articles/2871105 ; https://www.musicinafrica.net/magazine/suno-adjusts-ai-music-ownership-terms-after-warner-music-partnership
- BeepBox: https://www.beepbox.co/
- ZzFXM (MIT): https://github.com/keithclark/ZzFXM
- Strudel (AGPL-3.0): https://github.com/tidalcycles/strudel
