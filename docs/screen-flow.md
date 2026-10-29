# Screen flow

Which screen the player is on and how they move between screens: menu, how-to, waiting, Countdown, Match, the end screens and Rematch. Pure logic in `src/flow/`: it draws nothing, owns no timers (time moves only through `update(dt)`), and talks to the world through the player's calls and a `FlowNetwork`. The screens themselves are built from the approved prototypes in a later ticket and just render `flow.state()`.

| File | What it is |
|---|---|
| `ScreenFlow.ts` | The state machine. |
| `types.ts` | `FlowState`, `NetworkEvent`, `FlowNetwork`, `FlowConfig` and its defaults. |
| `FakeNetwork.ts` | An in-memory backend (`FakeBackend`) that pairs players, for tests and for building screens before the real network exists. |

## Screens (`flow.state().screen`)

| Screen | Details | Leaves when |
|---|---|---|
| `menu` | `serversResting`, `language` | `choose(...)`, `joinInvite(code)` |
| `howto` | `kind`, `secondsLeft` | `confirm()` (Enter) or after 30 s |
| `waiting` | `kind`, `phase` (`searching` / `connecting`), `inviteLink` (Private) | `cancel()` (Q), `matched` then `connected`, errors, opponent leaves |
| `countdown` | `mode`, `secondsLeft` (5 s) | ends into `starting` |
| `starting` | `mode` | the screen-off / black / screen-on gap (1.8 s); the Match begins when it ends |
| `match` | `mode` | `matchEnded(result)` (called by the app), the opponent leaves |
| `end` | Practice: `result: practiceOver`. Online: `result` (`won` / `lost` / `peace`), `kind`, `rematch` | Rematch, `searchAgain()`, `backToMenu()`, `playAgain()` (Practice) |
| `opponentLeft` | `during` (`waiting` / `countdown` / `match`), `youWin` (only in the Match), `kind` | `searchAgain()` (Public), `backToMenu()` |
| `error` | `reason`: `connectFailed`, `inviteFull`, `inviteExpired`; `kind` | `searchAgain()` (Public connect error), `backToMenu()` |

## Rules

- **Practice:** menu → the `starting` gap (TV off, 1 s black, TV on; **no Countdown, no how-to**) → Match, no network. Ends in a results screen (play again / menu); play again goes straight to the gap again.
- **Public:** how-to → `joinQueue(language)` → `matched` (connecting, 10 s to be confirmed or `connectFailed`) → `connected` → Countdown → `starting` → Match.
- **Private:** host: `createPrivate` → `inviteCreated` shows the link. Guest: `joinInvite(code)` skips the menu, then how-to, then `joinPrivate(code)`; a full or expired link is an error screen. `cancel()` and leaving are quiet (`network.leave()`).
- **The opponent leaves** (`opponentLeft`, or `opponentDisconnected` outside a Match): the `opponentLeft` screen, `youWin` true only in the Match. In a Match a dropped connection gets **5 s** to come back (`opponentReconnected`), then the player wins.
- **Rematch** (online end screen), as decided in the Rematch prototype ticket:
  - **Window (Public only): 10 s** after the Match to propose (`available.secondsLeft`); Private has no timer (`null`).
  - **A request** (mine: `waiting`; theirs: `incoming`) starts its own **10 s answer time** (`answerSecondsLeft`), always in full even if the window ran out; the window keeps counting in the background.
  - **Both propose, or an accept** → a new Countdown at once (same seeds, no how-to). Proposing while theirs is open counts as accepting.
  - **No answer in time** → a `notice` (`noAnswer` for my request, `tooLate` for theirs) for 2.4 s, then the options come back if the window is still open (or Private), else `closed`.
  - **Declined** (they deny mine, or I deny theirs) → a `declined` notice, then **Public: closed** (only Search new match / Menu), **Private: the options again**.
  - **Cancel** (`cancelRematch()`, only while `waiting`) tells the opponent and returns to the options (their `incoming` disappears).
  - **Opponent leaves** → `opponentLeft`. A proposal that arrived in time stays open past the window.
  - Timings are `FlowConfig` (`rematchWindowSeconds`, `rematchAnswerSeconds`, `rematchNoticeSeconds`). Network messages: `propose`, `accept`, `decline`, `cancel`.
- **Servers resting:** `setServersResting(true)` blocks Public, Private and invite joining on the menu (Practice works) and sends a how-to or a still-searching wait back to the menu. A Countdown, Match or Rematch already under way is not interrupted.

## Wiring it

`flow.state()` each frame tells the app what to show. When it enters `match` the app creates a `MatchEngine` / `MatchSession` and, when the engine's status leaves `running`, calls `flow.matchEnded(...)`. The real `FlowNetwork` (Lambda matchmaking plus the WebRTC channel) replaces `FakeBackend` later. Timings are `FlowConfig` (`DEFAULT_FLOW_CONFIG`).
