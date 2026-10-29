# Screens and the app host

How the app is put together: the flow decides *which* screen, the screens *draw* it, the host runs them. Code in `src/screens/`, the entry in `index.html` + `src/main.ts`.

| Piece | What it does |
|---|---|
| `src/flow/ScreenFlow` | Decides which screen is up and how screens connect ([screen-flow.md](screen-flow.md)). Draws nothing. |
| `src/screens/ScreenHost` | A `GameSession` the `AppShell` mounts. Each frame it advances the flow, draws the screen the flow is on, plays the screen-change effect when the screen changes, and locks input while it plays. |
| `src/screens/ScreenTransition` | The timeline of one effect (ramp up, swap the screen while the picture is hidden, optional hold, ramp down) and `transitionFor(prev, next)`, the rule for which effect plays. |
| `src/screens/Screen`, `ScreenSet` | A screen = `draw(text, t, state)` + optional `enter` and `onKey`. One per flow screen. |
| `src/screens/draw.ts` | Helpers every screen shares: the 128×45 grid size, `wrap`, `formatClock`, `centered`, `twoTone`, `box`. |
| `src/screens/simpleScreens.ts` | Plain versions of every screen. The ones with an approved design are replaced by the real ones; end, Opponent-left and error stay plain until their prototypes are done. |
| `src/dev/devKeys.ts` | Dev-only (`import.meta.env.DEV`): Alt keys that play the opponent and the network against the in-memory fake, so the whole flow can be walked alone. |

## Screen-change effects

The shader (`SCREEN_TRANSITION { mode, level }` in `src/render/ScreenFilters.ts`) has four modes; the app uses two, as decided in the prototype tickets:

- **Glitch** (`GLITCH`, 0.3 s: 0.13 out, 0.17 in) for every menu navigation.
- **TV off / on** (`TV_OFF_ON`: 0.35 s off, a **1 s black hold**, 0.45 s on = the flow's 1.8 s `starting` gap) between the Countdown and the Match. The Match scene is drawn from the `starting` state on, so it appears when the picture is back.

Input is locked while an effect runs (`ScreenTransition.active`), and typing is only enabled on the Match screen.

## Showing a text screen

`GameView.setScreen(draw)` makes the view hide the game scene, clear the text grid and call `draw(text, dt)` before the ASCII pass, so the CRT filters apply. `setScreen(null)` returns to the game scene. The prototypes reached into the view's private fields to do this; this is the real API.

## Running it

`npm run dev` serves the game at `/` and the visual sandbox at `/sandbox/`; `npm run build` builds both (the deployed site's root object is `index.html`). With `npm run dev`, Alt+F plays "opponent found", Alt+E / Alt+V ends the Match as lost / won, Alt+D makes the opponent leave, Alt+M / Alt+A / Alt+X make them propose, accept or decline a Rematch, Alt+R toggles "servers resting".
