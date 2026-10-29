# Match rules engine

The rules of one **Match** (or of **Practice**) as plain TypeScript: no DOM, no network, no timers of its own. Time moves only through `update(dt)`, so tests are deterministic. Code in `src/match/`, tests next to it (`npm test`).

| File | What it is |
|---|---|
| `MatchEngine.ts` | The rules. One engine = one Match. |
| `MatchSession.ts` | A thin `GameSession` that wires the engine to the existing `TypingInput` and to a `MatchTransport`. |
| `types.ts` | `MatchConfig`, `AttackWordSource`, `NetEvent`, `MatchTransport`, `MatchStatus`. |

## Using it

```ts
const engine = new MatchEngine({
  mode: 'versus',                 // or 'practice': no Attack word, no opponent, no Peace
  attackWords: seededPicker,      // { wordAt(i, t): string }, see below
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

**Attack words:** `wordAt(i, t)` returns the `i`-th word, picked at Match time `t` (the moment the previous Attack word was fired; `0` for the first). The real source is the seeded picker over the word list with the server-issued seed (a separate ticket); tests use a fake.

## Rules

- **Lives:** 3. A Word bullet that reaches the Cockpit costs one (`wordBulletArrived` + `lifeLost`); at 0 the Match is **lost**.
- **Defending comes first:** a submitted word that equals a Word bullet destroys it (the one closest to the Cockpit if several); only otherwise, if it equals the Attack word, it fires a **Shot**. Matching is `matchPrefix`'s rule: case-insensitive, NFC, exact letters (`ñ ≠ n`, `á ≠ a`).
- **Shots:** firing sends `shot {i, t, word}` to the opponent, where it becomes a Word bullet; the next Attack word is picked immediately. A Shot waits on the Radar until the opponent answers.
- **Damage:** each of my Shots that hits adds **40%** Enemy ship damage, capped at **100%** (so the second hit crosses 75%). The opponent's report of 0 Lives wins the Match.
- **Idle:** Idle means no typing. After **5 s** the engine emits one `idleNudge` (re-armed by typing). If **both** players are Idle for over **10 s** the Match ends in **Peace** (`peace` event; nobody wins).
- **Pace:** letters of correct words (Word bullets destroyed plus Attack words fired) per second over the last 10 s, eased over 1 s. The opponent's Pace is whatever they last reported.
- **Practice:** no Attack word, nothing is sent to a network, no Peace; the game calls `spawnBullet`. It ends when Lives reach 0.
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

## Not in the engine

The Countdown and the transitions between screens, the seeded word picker and its peer verification (a Shot's `{i, t, word}` is what the opponent will check), the real transport, the Rematch flow, win / lose / Peace screens, and the Match report.
