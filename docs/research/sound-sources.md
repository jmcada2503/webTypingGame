# Research: $0 sound sources for Typewing

Ticket: #150 (map #149). Checked 2026-11-01. Budget $0. Licence must allow shipping in a public web game.

## Recommendation

**Synthesize in code first, with a small set of CC0 samples where synthesis sounds thin.**

1. **Engine: raw Web Audio API**, written by us (one `AudioContext`, gain buses master → sfx / music, `AudioBufferSourceNode` one-shots). No runtime library is required.
2. **Most SFX: ZzFX** (MIT, about 0.9 KB gzip). Render each sound once to an `AudioBuffer` at unlock, then play the buffers. Its chiptune/arcade voice fits the ASCII + CRT look, the sounds are just parameter arrays in code (easy to tweak in `/sandbox/`), and there are no files to download.
3. **Keystrokes: a few short CC0 recorded clicks** (the CC0 OpenGameArt keyboard pack, or Kenney UI/Interface clicks), given variation at play time. Real mechanical "thock" is hard to synthesize convincingly. If the style prototype prefers a synthetic tick, ZzFX or a filtered noise burst also works, at zero bytes.
4. **Kenney CC0 packs** are the fallback for anything synthesis can't sell (big impacts, explosions). They need no attribution and add tens of KB per sound.
5. **Do not use AI generators for shipped assets.** The free tiers are non-commercial or come with licence conditions. Use them, if at all, only as reference for what a sound should feel like.

Music (out of scope here, but it shares the engine): ZzFXM (MIT, about 0.5 KB) or hand-rolled Web Audio sequencing keeps the same synth voice and allows adaptive layers. Tone.js is the fallback if scheduling gets complex (79 KB gzip).

### Trade-offs of this mix

| | Gain | Cost |
|---|---|---|
| Synth (ZzFX) | ~1 KB, no assets, retro voice matches the CRT, every sound is a tweakable number array, infinite variation (randomness param) | Quality ceiling is "arcade/8-bit"; realistic or weighty sounds are hard; making each sound takes design time |
| CC0 samples | Realistic keyboard clicks and impacts, no design time | Download size (OGG ~5–30 KB per short SFX), Safari OGG caveat (see below), less on-style unless processed |
| Raw Web Audio vs Tone.js | 0 KB, full control, matches the repo's no-framework style | We write the scheduling and voice-limiting ourselves |

## 1. Synthesized in code

Sizes were measured on 2026-11-01 from the published files (`gzip -9`).

| Library | Licence (primary source) | Size | Quality / fit | Tweakability |
|---|---|---|---|---|
| **Raw Web Audio** | n/a (browser API) | 0 KB | Ceiling is whatever we build: oscillators, noise buffers, filters, envelopes | Full control; most code to write |
| **ZzFX** (KilledByAPixel/ZzFX, npm `zzfx` 1.4.0) | MIT (repo + npm) | `ZzFXMicro.min.js` 1.2 KB raw / **0.86 KB gz**; full `ZzFX.js` 10 KB / 3.6 KB gz | 20-parameter one-shot synth: blips, lasers, hits, pickups, noise. Very on-style for retro/CRT. Built for js13k | Excellent: a sound is one array, and the online designer (killedbyapixel.github.io/ZzFX) copies arrays out. `randomness` param gives natural variation. Can render to samples (`zzfxG`) to pre-build buffers |
| **ZzFXM** (keithclark/ZzFXM) | MIT | `zzfxm.min.js` 0.6 KB / **0.46 KB gz** | Tracker-style music using ZzFX instruments; renders song to sample arrays then plays them | Songs are data; MOD → ZzFXM converter exists |
| **jsfxr** (chr15m/jsfxr, npm `jsfxr` 1.4.1) | Unlicense (public domain) per repo; sfxr.me says "Unrestricted commercial use" | `sfxr.js` 36 KB / 8.7 KB gz + `riffwave.js` 5.4 KB / 2.1 KB gz | Classic sfxr 8-bit voice; presets (`click`, `blipSelect`, `hitHurt`, `explosion`, `laserShoot`...) | Good: JSON or base58 strings, editor at sfxr.me. Free export is WAV only (OGG/MP3 is Pro). Heavier than ZzFX for a similar voice |
| **Tone.js** (npm `tone` 15.1.22) | MIT | `Tone.js` 346 KB / **79 KB gz** | High ceiling: synths, FX, transport, scheduling. Better suited to music than SFX | Great API, but it's a big dependency for SFX; it adds its own context and lookahead (scheduling latency) by default |
| Others worth knowing | | | **Howler.js** (MIT) is playback of files only (sprites, fallback formats), not synthesis; useful only if we go sample-heavy. **WebAudioFont / soundfonts** are sample-based instruments, MB-scale. | |

Fit with the look: an 8-bit/arcade voice matches the ASCII + CRT aesthetic. A bitcrush (`WaveShaper`) or a lowpass on the bus could make even samples sound "on the CRT".

## 2. CC0 / free packs

| Source | Licence (primary source) | Attribution | Content relevant to Typewing | Format / size |
|---|---|---|---|---|
| **Kenney** (kenney.nl) | "All game assets on the asset pages are public domain licensed (CC0)… free to use… even in commercial projects" (kenney.nl/support) | Not required (optional "Kenney"); Kenney logo reserved | 10 audio packs, including **Interface Sounds (100 files)**, **UI Audio (50)**, **Sci-fi Sounds**, **Impact Sounds**, **Digital Audio**, Music Jingles | Packs ship OGG (as historically shipped; signed download links blocked automated size checks). Short UI clicks are typically a few KB each; ship only the clips used |
| **OpenGameArt** | Per asset: CC0, CC-BY 3/4, CC-BY-SA 3/4, OGA-BY 3/4, GPL 2/3 (OGA FAQ). **Filter to CC0** to avoid attribution/share-alike | CC0: none (link back appreciated) | **"Keyboard Soundpack #1 [Typing and Single Keystrokes]" by unicaegames: CC0**, with 32 single keypress sounds + 10 typing + 7 generated (zip 8.5 MB; WAV source, we would trim and encode only a handful) | Mixed WAV/OGG; quality varies per author |
| **Freesound** | Each sound is CC0, CC-BY, CC-BY-NC (or legacy Sampling+). **Use CC0 only**: "copy, modify, distribute and perform the sound, even for commercial purposes". NC is unusable for a public product, and BY needs credits | CC0: none; can't claim authorship | Large pool of single-key, click and UI sounds (e.g. qubodup "Simple GUI Click", CC0, 0.25 s). License filter in search | Original upload format (FLAC/WAV/OGG/MP3); we re-encode |
| Mixkit, Pixabay, ElevenLabs "free SFX" pages | Custom licences, not CC0 | varies | Fine quality | Avoid: custom terms (redistribution limits) add review burden for no gain over CC0 |

Keep a `public/sfx/CREDITS.md` listing source + licence per file anyway (CC0 doesn't require it, but it documents provenance; OGA asks for a link back).

## 3. Free AI SFX generators

| Generator | Free tier / licence of output | Verdict |
|---|---|---|
| **ElevenLabs Sound Effects** | Free plan 10,000 credits/mo includes SFX, but ToS §1(c)(i): free users "may only use the Services for non-commercial purposes". The commercial licence starts at Starter (paid) | **No.** A public game risks the non-commercial clause |
| **Stable Audio Open** (1.0 / small, self-hosted) | Stability AI Community License: free incl. commercial for < $1M annual revenue; "You own any outputs"; HF access gated (accept terms); AUP applies. Trained on CC0/CC-BY/Sampling+ Freesound + FMA. Model card: "better at generating sound effects and field recordings than music" | **Allowed but not worth it.** Needs a GPU/local setup, and the licence has conditions (revenue cap, AUP) unlike CC0. Output is realistic, not retro. Possible later for one-off textures |
| **Meta AudioGen (AudioCraft)** | Weights CC-BY-NC-4.0 | **No** (NC) |
| Others (stableaudio.com hosted, various web tools) | Hosted free tiers are generally non-commercial or unclear | **No**, unless the terms are verified per tool |

## 4. Keystrokes at hundreds per minute

At 100 WPM, about 500 keys/min, roughly one keystroke every 120 ms. Faster typists hit 50 ms gaps.

**Latency**
- Trigger on `keydown` (the window capture listener in `KeyboardTypingInput`), **not** on `input`/`compositionend`. Dead keys and accents compose later, but the physical press should click immediately. The right/wrong-letter variant is decided on the same keydown where possible. For dead keys, play a neutral click, then let the composed letter decide right/wrong silently, or play the wrong-letter sound later.
- Create the context with `new AudioContext({ latencyHint: 'interactive' })` (the default). Play with `source.start()` (no future scheduling), so there is no Tone.js-style lookahead.
- Pre-decode or pre-render every buffer at unlock. Never `fetch`/`decodeAudioData` on the key path.
- The real floor is `ctx.baseLatency + ctx.outputLatency`. Log both in the `/sandbox/` listening page on each browser and OS. Bluetooth headphones add 100–200 ms that we can't fix.
- Don't use `<audio>` elements for keystrokes. They have high and jittery start latency, and are capped and costly at this rate.

**Cost**
- One `AudioBufferSourceNode` (+ optional `GainNode`) per keystroke, fire and forget. These are cheap and garbage-collected after `ended`. Thousands per minute are fine alongside WebGL.
- Cap simultaneous voices per sound type (e.g. max 4 keystroke voices; steal the oldest). Do the same for bursts (many Word bullets dying at once: play 1–3, not N).

**Repetition fatigue / variation tricks**
- 3–6 variants per sound (round-robin or random without immediate repeat).
- Per-play random `playbackRate` ±3–6% (pitch) and gain ±1–2 dB.
- ZzFX `randomness` param, or re-render a small pool of buffers with different seeds at unlock.
- Short (< 60 ms), soft attack/decay. Keystrokes sit well below SFX in the mix. Low-pass the bus slightly so high-frequency clicks don't grate over long runs.
- Wrong letter: a distinct timbre (lower pitch / buzzier / detuned), not just louder.
- Optional: vary by key region (space/enter heavier, letters lighter), like real keyboards.
- Keystrokes already have their own toggle (map Notes), which is the escape hatch for fatigue.

## 5. Browser support

| Feature | Chrome | Firefox | Safari |
|---|---|---|---|
| Unprefixed `AudioContext`, `AudioBufferSourceNode`, gain/filter nodes | yes | yes | yes (14.1+). `decodeAudioData` promise form is Baseline since Apr 2021 |
| ZzFX / synthesized buffers | yes | yes | yes (no codec involved, which is a plus for synthesis) |
| **OGG Vorbis decode** | yes | yes | **Full only from Safari 18.4 / iOS 18.4**; partial 14.1–18.3 (iOS 17.4–18.3); none before. If shipping samples, ship **MP3 or AAC (m4a)** (universal), or OGG + MP3 fallback. Opus-in-WebM/CAF has its own Safari caveats, so avoid it for simplicity |
| iOS silent switch | n/a | n/a | Web Audio is muted by the ringer switch by default (audio session `ambient`). `navigator.audioSession.type = 'playback'` (Safari-only, iOS 17+) overrides it. Decide whether to set it (respecting the switch is arguably polite). Test on device |
| Context `interrupted` state | | | Safari can move the context to `interrupted` (calls, backgrounding). Resume on `visibilitychange`/next key |

## 6. Autoplay unlock on first key

- Chrome: an `AudioContext` created before a user gesture starts `suspended` and needs `resume()` after one (developer.chrome.com/blog/autoplay). Same model in Firefox and Safari.
- `keydown` **is** an activation-triggering event (MDN User activation), **except Esc**, browser-reserved shortcuts, and keys like Caps Lock, Num Lock and Print Screen ("may vary by browser"). Also `mousedown`, `pointerdown` (mouse), `pointerup`/`touchend` (touch).
- Pattern: create the context lazily (or at load, suspended). On the first trusted `keydown`/`pointerdown`, call `ctx.resume()`, render or decode the buffers, then play. Keep listening until `ctx.state === 'running'` (the first key might be Esc). Re-check on every key, cheaply (`if (ctx.state !== 'running') ctx.resume()`), to cover Safari `interrupted`.
- The very first keypress's own sound may be lost or late while the context resumes. That's acceptable; the menu's first key is usually navigation.
- This matches the map default: "sound on for first visit; starts on the first keypress".

## Sources

- ZzFX repo + licence: https://github.com/KilledByAPixel/ZzFX (MIT; files measured: `ZzFXMicro.min.js`, `ZzFX.js`)
- ZzFXM: https://github.com/keithclark/ZzFXM (MIT)
- jsfxr: https://github.com/chr15m/jsfxr (Unlicense); https://sfxr.me/
- Tone.js: https://github.com/Tonejs/Tone.js (MIT); npm `tone` 15.1.22, `build/Tone.js` measured
- Kenney licence: https://kenney.nl/support; audio packs: https://kenney.nl/assets/category:Audio, https://kenney.nl/assets/interface-sounds, https://kenney.nl/assets/ui-audio
- OpenGameArt licences: https://opengameart.org/content/faq; keyboard pack (CC0): https://opengameart.org/content/keyboard-soundpack-1-typing-and-single-keystrokes
- Freesound licences: https://freesound.org/help/faq/; example CC0 click: https://freesound.org/people/qubodup/sounds/159697/
- ElevenLabs: https://elevenlabs.io/pricing, https://elevenlabs.io/terms-of-use (§1(c)(i) non-commercial for free users)
- Stability: https://stability.ai/license, https://stability.ai/community-license-agreement, https://huggingface.co/stabilityai/stable-audio-open-1.0, https://huggingface.co/stabilityai/stable-audio-open-small
- AudioGen: https://huggingface.co/facebook/audiogen-medium (CC-BY-NC-4.0)
- Autoplay: https://developer.chrome.com/blog/autoplay; user activation: https://developer.mozilla.org/en-US/docs/Web/Security/User_activation
- `AudioContext` latencyHint: https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/AudioContext; decodeAudioData: https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData
- OGG Vorbis support: https://caniuse.com/ogg-vorbis
- iOS audioSession: https://bugs.webkit.org/show_bug.cgi?id=264473, https://bugs.webkit.org/show_bug.cgi?id=251532

Unverified: exact Kenney pack download sizes (signed links blocked automated download). Typical output-latency figures per OS should be measured in `/sandbox/`.
