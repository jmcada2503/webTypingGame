# Screens and the app host

How the app is put together: the flow decides *which* screen, the screens *draw* it, the host runs them. Code in `src/screens/`, the entry in `index.html` + `src/main.ts`.

| Piece | What it does |
|---|---|
| `src/flow/ScreenFlow` | Decides which screen is up and how screens connect ([screen-flow.md](screen-flow.md)). Draws nothing. |
| `src/screens/ScreenHost` | A `GameSession` the `AppShell` mounts. Each frame it advances the flow, draws the screen the flow is on, plays the screen-change effect when the screen changes, and locks input while it plays. On the Match screen it runs a Match session (from the `createMatch` function it is given), feeds its events and snapshot to the game scene, flashes GO, and tells the flow when it ends. |
| `src/screens/ScreenTransition` | The timeline of one effect (ramp up, swap the screen while the picture is hidden, optional hold, ramp down) and `transitionFor(prev, next)`, the rule for which effect plays. |
| `src/screens/Screen`, `ScreenSet` | A screen = `draw(text, t, state)` + optional `enter` and `onKey`. One per flow screen. |
| `src/screens/draw.ts` | Helpers every screen shares: the 128×45 grid size, `wrap`, `formatClock`, `centered`, `twoTone`, `box`. |
| `src/screens/menuScreen.ts`, `howtoScreen.ts`, `waitingScreen.ts`, `countdownScreen.ts` | The approved designs: main menu (layout B), how-to (layout B), waiting (terminal style C3), Countdown (variant A: a huge 5 to 1, never 0). Specs: the closed prototype tickets. |
| `src/screens/content.ts` | The screens' pure logic, tested: menu selection rules, online-count placeholder, the waiting log and tips, the how-to demo timeline, and the placeholder name and sponsor link. |
| `src/screens/simpleScreens.ts` | Plain versions of every screen. `main.ts` overrides the ones that have an approved design; Practice game over, Opponent-left and error stay plain until their builds; the online end screens (`endScreens.ts`) are the approved Win, Lose and Peace designs with the Rematch menu (`rematchMenu.ts`: status line, choices with arrows/hjkl + Enter, window or answer-time bar). |
| `src/dev/devKeys.ts` | Dev-only (`import.meta.env.DEV`): Ctrl keys that play the opponent and the network against the in-memory fake, so the whole flow can be walked alone. |

## Screen-change effects

The shader (`SCREEN_TRANSITION { mode, level }` in `src/render/ScreenFilters.ts`) has four modes; the app uses two, as decided in the prototype tickets:

- **Glitch** (`GLITCH`, 0.3 s: 0.13 out, 0.17 in) for every menu navigation.
- **TV off / on** (`TV_OFF_ON`: 0.35 s off, a **1 s black hold**, 0.45 s on = the flow's 1.8 s `starting` gap) between the Countdown and the Match. The Match scene is drawn from the `starting` state on, so it appears when the picture is back.

Input is locked while an effect runs (`ScreenTransition.active`), and typing is only enabled on the Match screen.

## Showing a text screen

`GameView.setScreen(draw)` makes the view hide the game scene, clear the text grid and call `draw(text, dt)` before the ASCII pass, so the CRT filters apply. `setScreen(null)` returns to the game scene. `GameView.setOverlay(draw)` draws extra text over the game scene (the GO flash). The prototypes reached into the view's private fields to do both; these are the real APIs.

## The Match screen

The flow's `starting` gap (the TV effect) draws the game scene idle (nothing flying). When the flow reaches `match`, the host calls `createMatch(mode)`, attaches the typing input, starts the session and, for online Matches, flashes a green **GO** over the scene for 0.9 s (it blinks 8 times a second). Practice has no Countdown (menu → the TV gap → Match), so it has no GO either. Input is on only from then on. When the session's status leaves `running` (`won`, `lost` or `peace`), the host calls `flow.matchEnded(status)` and the flow moves to the end screen; the session is disposed once that screen is up.

**Endings.** An online Match that ends does not cut to the end screen: the flow is on `end` at once, but the host keeps the game scene up and plays the ending (`src/screens/endings.ts`, pure timelines) with input off, then changes screen. **Win:** the last hits land, a bigger green explosion and shake, the Enemy ship vanishes (0.5 s), glitch to the screen at 1.6 s. **Lose:** the stars slow to a stop, the Enemy ship drifts down and close and looms (lights dimming, the cockpit rumbling), then rushes up and over the player and out behind the camera, then TV off / 1 s black / on at 5.2 s. **Peace:** the Idle nudge's `PEACE IN n` label (above the Attack word) stays up as `PEACE!!` (the host reports `peaceIn: 0`), the Enemy ship flies away and the stars race past, glitch at 4.6 s. The view gets this through `GameView.setEnding(frame)`. The Rematch clock starts at the same moment for both players (`rematchClockStart`: when the loser's end screen is up), so a Win's shorter scene doesn't leave the winner's window closed while the loser can still propose; the host holds the flow's clock until then (`flow.holdRematch`). The end screens show the stats block (`matchStatsLines`, from `MatchEngine.stats()`); Lose adds ENEMY DAMAGE. Practice has no ending. Dev keys: `Ctrl+V` win, `Ctrl+E` lose, `Ctrl+P` peace (they end the Match through the host so the ending plays).

`src/main.ts` decides what runs. **Practice** runs the real `PracticeSession` (words from the game on a ramp; it measures your speed first), and its Game Over screen shows a **score** (the difficulty level the run reached, as a second of the 0 to 420 s ramp, times 10: 0 to 4,200; 0 if the run never got past the speed measurement) and the run's results (time survived, difficulty reached %, words, accuracy, pace). **Online** matches use `MatchSession` over a `MatchEngine` with seeded Attack words from the chosen language's word list (the seed will come from the server; for now it is local, and there is no transport, so the opponent never answers).

## Running it

`npm run dev` serves the game at `/` and the visual sandbox at `/sandbox/`; `npm run build` builds both (the deployed site's root object is `index.html`). With `npm run dev`, Ctrl+F plays "opponent found", Ctrl+E / Ctrl+V ends the Match as lost / won, Ctrl+D makes the opponent leave, Ctrl+M / Ctrl+A / Ctrl+X make them propose, accept or decline a Rematch, Ctrl+R toggles "servers resting".
