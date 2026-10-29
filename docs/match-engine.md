# Match rules engine

The rules of one **Match** (or of **Practice**) as plain TypeScript: no DOM, no network, no timers of its own. Time moves only through `update(dt)`, so tests are deterministic. Code in `src/match/`, tests next to it (`npm test`).

| File | What it is |
|---|---|
| `MatchEngine.ts` | The rules. One engine = one Match. |
| `MatchSession.ts` | A thin `GameSession` that wires the engine to the existing `TypingInput` and to a `MatchTransport`. |
| `types.ts` | `MatchConfig`, `AttackWordSource`, `NetEvent`, `MatchTransport`, `MatchStatus`. |
| `attackWords.ts` | The seeded Attack-word picker: `pick`, `createAttackWordSource`, the difficulty curve. |
| `ShotVerifier.ts` | Checks the opponent's Shots against their seed. |

## Using it

```ts
const engine = new MatchEngine({
  mode: 'versus',                 // or 'practice': no Attack word, no opponent, no Peace
  attackWords: createAttackWordSource(mySeed, list), // { wordAt(i, t): string }, see Seeded Attack words
  verifyShot: (shot, at) => verifier.verify(shot, at).ok, // optional: ignore Shots that fail the check
  startIndex: 0,                  // continue the word index after a Rematch
  bulletFlightSeconds: 8,         // Flight 0 → 1 (placeholder, tuned later)
  shotFlightSeconds: 8,           // how long a Shot takes to reach the Enemy ship on the Radar
});
const session = new MatchSession(engine, transport); // transport is omitted in Practice
session.attachInput(typingInput);
session.start();
// the app shell then calls session.update(dt) / session.state() every frame
```

Engine methods: `typed(word)` (the Typed word changed, which counts as activity), `submit(word)` (Space or Enter), `receive(netEvent)`, `drainOutgoing()`, `spawnBullet(word)` (Practice), `update(dt)` → `ViewEvent[]`, `state()` → `GameViewState`, `stats()`, and `status` (`running | won | lost | peace`). `MatchSession` calls these from `TypingInput.onChange` / `onSubmit`; the engine never sees raw keys. After the Match ends it ignores input, events and time, and the session disables the input.

**Attack words:** `wordAt(i, t)` returns the `i`-th word, picked at Match time `t` (the moment the previous Attack word was fired; `0` for the first). The real source is the seeded picker (below); tests use a fake.

## Rules

- **Lives:** 3. A Word bullet that reaches the Cockpit costs one (`wordBulletArrived` + `lifeLost`); at 0 the Match is **lost**.
- **Defending comes first:** a submitted word that equals a Word bullet destroys it (the one closest to the Cockpit if several); only otherwise, if it equals the Attack word, it fires a **Shot**. Matching is `matchPrefix`'s rule: case-insensitive, NFC, exact letters (`ñ ≠ n`, `á ≠ a`).
- **Shots:** firing sends `shot {i, t, word}` to the opponent, where it becomes a Word bullet; the next Attack word is picked immediately. A Shot waits on the Radar until the opponent answers.
- **Damage:** each of my Shots that hits adds **40%** Enemy ship damage, capped at **100%** (so the second hit crosses 75%). The opponent's report of 0 Lives wins the Match.
- **Idle:** Idle means no typing. After **5 s** the engine emits one `idleNudge` (re-armed by typing). If **both** players are Idle for over **10 s** the Match ends in **Peace** (`peace` event; nobody wins).
- **Pace:** letters of correct words (Word bullets destroyed plus Attack words fired) per second over the last 10 s, eased over 1 s. The opponent's Pace is whatever they last reported.
- **Practice:** no Attack word, nothing is sent to a network, no Peace; the game calls `spawnBullet(word, flightSeconds?)` (the optional flight time lets later words fly faster). It ends when Lives reach 0. `src/practice/` drives it, see Practice below.
- `stats()` gives counters for the results screen and the Match report: elapsed time, correct words and letters, wrong submits, Word bullets destroyed and arrived, Shots fired, hit and defended.

## Network events (`NetEvent`)

The only thing crossing the wire. Each engine produces them with `drainOutgoing()` and consumes the other's with `receive()`.

| Event | Meaning |
|---|---|
| `shot {i, t, word}` | I fired my `i`-th Attack word, picked at Match time `t`. It flies at you as a Word bullet (`e<i>`). |
| `defended {i}` | I destroyed your Shot `i`. |
| `hit {i, lives}` | Your Shot `i` reached me; I have `lives` left. |
| `presence {idleFor, pace}` | Sent every 2 s: seconds since I last typed, and my Pace. Peace needs both sides' Idle time. |
| `peace` | Both of us were Idle too long: the Match is over. |

Each client judges its own defense; the opponent trusts these reports. A `MatchTransport` (`send(event)` and `onEvent(cb)`) carries them: P2P WebRTC implements it, and a relay could replace it without touching the rules.

## Practice

`PracticeSession` (`src/practice/`) is a `GameSession`: the engine in `practice` mode plus a `PracticeDirector` that fires the Word bullets. Build one with `createPracticeSession(language)` (loads the word list) or `new PracticeSession({ list, random? })`. Local randomness only: no seeds, no network.

- **Ramp** (`PRACTICE_RAMP`, tunable): from 0 s to 420 s, then it stays. A word every 4 s down to 1 s (each gap varies by up to 20%), flight time 10 s down to 5.5 s, tier chances short/medium/long 70/28/2% to 10/40/50%. First word at 1.5 s. A word already on screen is not repeated. Endless: it ends only at 0 Lives. These numbers are a first guess, tuned by playing: `/sandbox/practice.html?lang=en|es` runs the real thing with a plain text result (dev page, not part of the build).
- **Placing the player** (`PRACTICE_CALIBRATION`, `PRACTICE_PLACEMENT`): a run starts with 5 gentle words (a fixed short/medium/long mix, one every 2.5 s, 10 s flight). When 5 have been typed or missed, the player's Pace is measured (letters typed / seconds with words on screen, at least 3 s) and the ramp clock jumps ahead to the first second whose demand (letters per second the ramp asks for, from the words' average length and the gap) is 80% of that Pace (`PRACTICE_PLACEMENT.share`). The ramp then keeps rising from there, so a fast typist skips the easy start and a slow one starts at 0. A missed word adds time but no letters, so it lowers the level. A player who never gets through the 5 words is never placed (the run ends first).
- **Acceleration** (`PRACTICE_ACCELERATION.emptyScreenRate`, 3): after placement the ramp clock normally runs 1 ramp second per second. While no Word bullet is on screen it runs 3 per second, so a player who clears the screen fast climbs faster and is never left waiting at an easy level. Only the empty seconds count extra; it does not apply during the 5 calibration words. `session.result().currentLevel` is the ramp second the run is at now (capped at the end of the ramp).
- **Result** (`session.result()`, final once the status is `lost`): `survivedSeconds`, `activeSeconds` (time with at least one Word bullet on screen), `wordsTyped`, `lettersTyped`, `wrongSubmits`, `accuracy` (right submits / all submits, `null` if none), `averagePace` (letters of correct words per second of `activeSeconds`: time with an empty screen is left out, there is nothing to type), `peakPace` (never below the average), `wpm` (average Pace, 5 letters = 1 word), `calibrationPace`, `startLevel` (the ramp second the run was moved on to) and `currentLevel` (all three `null` until placed). The result screen itself is a later ticket.

## Seeded Attack words

At pairing the server issues each player a 32-bit seed; both players know both seeds. Player P's `i`-th Attack word is `pick(seedP, i, t, list)`: a pure function of the seed, the index, the Match time `t` it was picked at, and the word list. It is stateless (any `i` can be recomputed in any order) and uses only exact integer maths, so every browser gets the same word.

- **Difficulty:** `t` moves the chance of each length tier in a straight line from `DIFFICULTY.start` (short 55%, medium 40%, long 5%) at 0 s to `DIFFICULTY.end` (15 / 40 / 45%) at `rampSeconds` (180 s), then it stays. Short words are always possible. The numbers are a tunable constant in `attackWords.ts`.
- **Rematch:** the same seed keeps being used; the next Match starts at `startIndex` = the next unused `i`, with `t` back at 0. No API call.
- **Verifying:** `new ShotVerifier({ seed: opponentSeed, list, startIndex, oneWayLatency, report })`, then pass `verify(shot, matchTime).ok` to the engine as `verifyShot`. A Shot is accepted when it is the next index (a cheater can't skip ahead to easy words), its `t` is within 1 s of (previous Shot's arrival time - one-way latency; exactly 0 for the first), `t` doesn't go backwards, and the word is what the seed picks. Otherwise the engine ignores it (no Word bullet) and the verifier reports `invalid_attack` with a reason (`bad_index`, `bad_time`, `non_monotonic`, `bad_word`, `malformed`). Accepted Shots more than half way into the tolerance are reported as `near_miss`. A repeat of an accepted Shot is ignored quietly.
- **Only accepted Shots advance the sequence.** That stops a modified client skipping a hard word by sending a bad Shot, but an honest Shot that is wrongly rejected (clocks further apart than the tolerance) also blocks that player's later Shots. The tolerance is tuned with the near-miss logs.
- **Both sides must agree** on the picker, the curve and the word list. `ATTACK_PICKER_VERSION` (bump it on any change to `attackWords.ts`) and the word list's `listVersion` should be compared in the handshake. A test pins exact words for fixed inputs so a change can't slip by.
- **The Match clock:** the check assumes both engines' clocks run in step (the Countdown's `startAt` syncs them). `update(dt)` clamps `dt` in the app shell, so a frozen or throttled tab drifts from the opponent's clock.

## Not in the engine

The Countdown and the transitions between screens, the real transport, the Rematch flow, win / lose / Peace screens, and the Match report.
