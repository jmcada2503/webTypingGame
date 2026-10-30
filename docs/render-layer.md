# Render layer

How the future game drives the graphics. The render layer draws; the game owns all truth (Lives, Word bullets, Shots, Paces, damage). Words used here (Cockpit, Word bullet, Flight, Shot, Pace...) are defined in [`CONTEXT.md`](../CONTEXT.md).

Run the reference client: `npm run sandbox`. Its tweak panel can trigger every state and event below.

## The three pieces

```
          typing                    state + events                   pixels
  KeyboardTypingInput ──► GameSession ───────────────► GameView ──► GpuAsciiRenderer
   (src/input)            (src/app/GameSession.ts)     (src/view)     (src/render)
          ▲                       ▲
          └────────── AppShell (src/app/AppShell.ts) runs the frame loop ─────────┘
```

| Piece | File | Job |
|---|---|---|
| `TypingInput` | `src/input/TypingInput.ts` | The Typed word as the game understands it (see [Typing input](#typing-input)). |
| `GameSession` | `src/app/GameSession.ts` | **What the game implements.** Advances the game, hands the view a snapshot and one-off events. |
| `GameView` | `src/view/GameView.ts` | **What the game calls.** Draws a snapshot, plays events. Implementation: `AsciiGameView`. |
| `AppShell` | `src/app/AppShell.ts` | Mounts the canvas, runs the loop, re-fits on resize / fullscreen, fullscreen button. |

The future `MatchSession` (real mechanics + networking) implements `GameSession`; nothing else changes. The sandbox's `SandboxSession` is the reference implementation.

## Lifecycle

```ts
const view = await AsciiGameView.create();      // async: waits for the font before building the glyph atlas
const input = new KeyboardTypingInput();
const session = new MatchSession(/* ... */);     // yours, implements GameSession
const shell = new AppShell(view, session, input);
shell.start();                                  // mounts canvas + fullscreen button, attaches input, starts the loop
// ... later
shell.dispose();                                // stops the loop, disposes session, input and view
```

Every frame the shell does exactly this (you can run your own loop instead, in the same order):

```ts
const events = session.update(dt);              // dt in seconds, capped at 0.1 s by the shell
events.forEach((e) => view.trigger(e));         // events first...
view.render(session.state(), dt);               // ...then the snapshot
```

- The view never reads input and never runs its own frame loop.
- `view.resize(window.innerWidth, window.innerHeight, devicePixelRatio)` re-fits; the shell calls it on load, window resize (debounced 100 ms) and fullscreen changes.
- `AsciiGameView.dispose()` frees everything (textures, render targets, meshes).

## Screen and sizing

- Fixed **128×45 character grid** on every screen (`ASCII_STYLE.grid`), so layout is identical for every player. Cells scale to the window (largest integer cell, letterboxed on black); the glyph atlas is rebuilt at the real cell size on every resize.
- Palette (`ASCII_STYLE.palette`): monochrome white / gray on black, plus `red` (Attack word, damage), `green` (typed-prefix match, hits on the enemy), `yellow` (firing sparks), `dim`.
- Fullscreen: the shell's ⛶ button (a key would collide with typing). Esc exits.

## The snapshot: `GameViewState`

`session.state()` is handed to `view.render()` every frame. The view keeps no game truth; it only draws this plus its own animations. (`src/view/GameViewState.ts`)

| Field | Type | Drawn as |
|---|---|---|
| `lives` | `0..3` | Three red lamps on the Cockpit's left console (a lost life is a dim lamp). A lamp that just went out flickers for 1.2 s. Also the **player damage** (`PlayerDamageFx`): at 2 Lives smoke and sparks from the Lives console, it flickers, 2 switches die, a yellow `HULL DAMAGED`, rare Radar glitches and a light tremble; at 1 Life (and 0) both consoles, thicker smoke with embers, 5 dead switches, a blinking red `!! HULL CRITICAL !!`, frequent glitches, a stronger tremble and stuttering console labels. When a level is reached: a spark burst from the console that broke, a console blackout, a Radar glitch and a hard jolt. Only the side consoles and the yoke (column, bar, grips) move: the Typed word screen and everything above it never do. |
| `typedWord` | `string` | The Typed word in the Cockpit's input screen (1.2× size, blinking cursor). |
| `attackWord` | `string` | The Attack word, red, at the right end of the Cockpit's `ATTACK` bar (1.2× size). Its already-typed letters turn white. |
| `wordBullets` | `{ id, word, flight }[]` | The Word bullets: outlined real-font words flying from the Enemy ship to the Cockpit. `flight` 0 → 1 is the whole path. |
| `shots` | `{ id, word, flight }[]` | The player's own Shots, shown as marks on the Radar. `flight` 0 = just fired, 1 = reaching the Enemy ship. |
| `enemyDamage` | `0..1` | Enemy ship damage: smoke grows with it; the left wing loses its tip from 0.4; from 0.75 the right engine is gone and the right wing is shortened. |
| `pace` | `{ player, enemy }` | Both Paces in letters per second (see [Pace](#pace)). Drives the stars and the Enemy ship's size. |

Rules:

- **`id`s are yours and stable.** The view tracks each Word bullet and Shot by `id`; a new `id` makes a new visual, a missing `id` removes it. Never reuse an `id`.
- Words are Spanish, 1–20 characters, lowercase with `ñ` / accents. Longer words draw but may overflow.
- Targets (the green prefix on a Word bullet) are computed by the view as `matchPrefix(state.typedWord, bullet.word)` (`src/utils/matchPrefix.ts`). **Use the same function in the game to decide hits**, so green letters never disagree with what destroys a bullet. Rule: case-insensitive, exact letters (`ñ` ≠ `n`, `á` ≠ `a`), NFC-normalized.

### Pace

Computed by the game (the sandbox does it in `SandboxSession`): the **letters of correct words per second**, over the last ~10 s, eased over ~1 s so it doesn't step. A word counts once it's submitted correctly (a Word bullet destroyed or an Attack word fired); wrong or unfinished words count nothing. Both players have one. The view only reads it:

- stars fly toward the Cockpit while `player` leads and away while `enemy` leads, at a speed set by `player` (0 = still, 4 = fast, 8 and above = super fast);
- the Enemy ship is 1.5× at equal Paces, up to 2× when the enemy leads by 2 or more, down to 0.5× when the player does.

## Events: `ViewEvent`

One-off moments that start an animation. They are not state: send each once, at the frame it happens. (`src/view/GameViewState.ts`)

| Event | Send when | The view plays |
|---|---|---|
| `{ type: 'wordBulletDestroyed', id }` | The player destroyed a Word bullet | The word's letters fly apart, with a green ring on the grid. |
| `{ type: 'wordBulletArrived', id }` | A Word bullet reached the Cockpit | The word vanishes and a red explosion goes off at the impact point. |
| `{ type: 'lifeLost' }` | Lives went down | Black screen flash with color fringes. No camera shake, so the Attack word and the Typed word stay still; the lamp flicker and the damage jolt come from `lives` dropping. |
| `{ type: 'attackFired', id, word }` | The player fired the Attack word (a Shot starts) | Many tiny yellow sparks burst from behind the Cockpit's center toward the Enemy ship. |
| `{ type: 'shotHit', id }` | A Shot reached the Enemy ship | `HIT!!` on the Radar, a big green explosion on the ship, which sags. |
| `{ type: 'shotDefended', id }` | The opponent destroyed a Shot | A dim `x` stays on the Radar where the Shot was for 0.5 s. |
| `{ type: 'enemyFired', id }` | The Enemy ship launches a Word bullet | The ship flashes and throws a ring of yellow grid sparks. |
| `{ type: 'idleNudge' }` | The player has typed nothing for 5 s | Nothing yet: the animation is designed in its own prototype ticket. |
| `{ type: 'peace' }` | Both players stayed Idle too long: the Match ended in Peace | Nothing yet: the animation is designed in its own prototype ticket. |

Ordering rules:

1. **Trigger events before rendering the frame where the thing is gone.** When a Word bullet disappears from `wordBullets`, send `wordBulletDestroyed` / `wordBulletArrived` with its `id` *before* the `render()` that no longer lists it: the view keeps the sprite until the event arrives so the effect starts where the word was. If no event comes, the sprite just disappears on that render.
2. Same for Shots: send `shotHit` / `shotDefended` before the first render that no longer lists the Shot. The `x` appears where the Radar last drew that Shot, so a Shot removed before it was ever drawn leaves no `x`.
3. `lifeLost` is separate from `wordBulletArrived`: an arrival does not imply a life lost (the game decides), so send both when it applies.
4. `attackFired` and `shots` go together: add the Shot to `state.shots` in the same frame you send the event.
5. The view can show the last event's name and id as a dim debug label at the top left for 1.2 s. It is off by default; the sandbox turns it on with `view.debugEventLabel = true`.

## Typing input

`TypingInput` (`src/input/TypingInput.ts`) gives the game the Typed word, not raw keys:

- `typedWord`, `onChange(cb)`, `onSubmit(cb)` (returns an unsubscribe function), `clear()`, `setEnabled(on)`, `dispose()`.
- Letters append (including `ñ` and accents from dead keys: a hidden always-focused text field lets the browser compose them), Backspace deletes, **Space or Enter submits**; after submit callbacks run, `typedWord` resets to `''`. Non-letters are dropped, text is lowercased, max 20 characters.
- The input leaves focus alone while another form field (e.g. the sandbox panel) is being edited.
- The session reads it through `attachInput(input)`, which the shell calls once at start.

The game decides what a submit means. The reference client's rule: **defending comes first**: if the submitted word matches a Word bullet (closest to the Cockpit if several), destroy it; only otherwise, if it equals the Attack word, fire. The view uses the same priority: while the Typed word targets a Word bullet, the Attack word isn't lit.

## Typing feedback the view adds on its own

The view derives these from the snapshot; the game sends nothing:

- **Correct key** (the new Typed word still starts some Word bullet): that Target's next letter swells briefly.
- **Wrong key** (starts no Word bullet and isn't a prefix of the Attack word): the Typed word shakes sideways and the camera does a quick left-right shake.
- **Targets:** matched letters turn green; the typed letters of the Attack word turn white (not while a Word bullet is the target).

## Look: knobs and screen filters

Each effect has a `*_LOOK` object of numbers (sizes, times, strengths), exported from its file and editable live from the sandbox panel. The game doesn't need to touch them; change the defaults in the file to retune.

| Object | File | Controls |
|---|---|---|
| `ENEMY_LOOK` | `src/view/enemy/EnemyShip.ts` | Enemy ship position, size, idle bob / sway / bank. |
| `WORD_FLIGHT`, `WORD_LOOK` | `src/view/words/` | Word bullet path and size. |
| `HIT_LOOK` | `src/view/juice/HitFx.ts` | Camera shake (Enemy ship destroyed, Lose rumble), debris, flash; wrong-key shake. |
| `PLAYER_DAMAGE_LOOK` | `src/view/juice/PlayerDamageFx.ts` | Smoke amount, tremble, the jolt and blackout when a Life goes (per-level settings: `DAMAGE_LEVELS` in `playerDamage.ts`). |
| `DESTROY_LOOK` | `src/view/juice/WordDestroyFx.ts` | Destroy effect. |
| `SHOT_HIT_LOOK` | `src/view/juice/ShotHitFx.ts` | Explosion on the Enemy ship. |
| `DAMAGE_LOOK` | `src/view/juice/EnemyDamageFx.ts` | Smoke and when parts break. |
| `ATTACK_SPARKS_LOOK` | `src/view/juice/AttackSparks.ts` | Attack word sparks. |
| `PACE_LOOK` | `src/view/juice/PaceMotion.ts` | Fast / limit Pace, star speeds, ship size range. |
| `STAR_DRIFT` | `src/view/enemy/StarDrift.ts` | Star speed (written by Pace) and `motion`. |
| `SCREEN_FILTERS` | `src/render/ScreenFilters.ts` | The always-on old-monitor look: curve, color fringes, dark edges, glow, scanlines, grain, flicker. |

- **Player setting for moving stars:** `STAR_DRIFT.motion = false` freezes the stars whatever the Pace (moving stars can cause dizziness). The settings screen is out of this effort's scope.
- **Screen filters:** `SCREEN_FILTERS` is the old-monitor look. All off renders straight to the screen with no extra cost.

## Performance budget

Measured in Chrome with the sandbox (60 Hz display, one Mac), under the worst moment the sandbox can make: 60 and 150 Word bullets on screen, a damaged Enemy ship with smoke, Paces at the limit (fast stars), and every effect firing over and over (Shots hit and defended, attack sparks, enemy firing, life lost, wrong keys), with the old-monitor filter on.

| Drawing size | Result |
|---|---|
| up to 3840×2160 (4K), incl. 2560×1440 and 1920×1080 | 60 fps, frame times 16.7–18 ms, with 150 Word bullets and everything firing |
| 5120×2880 (5K), before the cap | 40–58 fps, spikes to 67 ms |

- **The cost is pixels, not objects.** Word bullets (150 at once), effects and typing feedback cost nothing measurable up to 4K; the full-screen passes (glow, text layer, ASCII) are what grow with the screen. Glow is the largest single part (about 8 fps at 5K).
- **Limit in the code:** the drawing buffer is capped at 3840 px wide (`MAX_CANVAS_WIDTH` in `src/render/asciiStyle.ts`). On bigger screens (e.g. a 5K display) it draws at 4K and the browser scales the canvas to the full screen size. At 5K this brings it back to 60 fps.
- **No cap on Word bullets or effects is needed.** Limits for the game to respect: none beyond the above. A real Match has far fewer than 150 Word bullets.
- **Levers if a slower machine struggles:** turn `SCREEN_FILTERS.glow` off (the biggest saving), then lower `MAX_CANVAS_WIDTH` (e.g. 2560).
- **Not measured:** Safari, and low-end or integrated GPUs. To check: `npm run sandbox`, set a large window or fullscreen, turn on auto-spawn with a fast spawn rate and read the FPS meter at the top left.

## The sandbox as a reference client

`src/sandbox/` (open with `npm run sandbox`, page `/sandbox/`):

- `SandboxSession` implements `GameSession` with tweak-panel knobs instead of mechanics. It shows the minimum a real session does: keep arrays of `wordBullets` and `shots`, advance `flight`, queue `ViewEvent`s in `update()`, build a `GameViewState` in `state()`, handle `onSubmit`, measure Pace.
- `main.ts` builds the lil-gui panel (all folders collapsed by default). In dev builds `window.sandbox` is the session, for scripted checks.
- Sandbox-only shortcuts, **not** real rules: arrivals cost a life only if `arrivalCostsLife`; each Shot that hits adds `damagePerHit` damage; the Attack word changes after each fire; Pace can be overridden from the panel.

To see an effect: spawn a Word bullet and destroy / arrive it, set Lives, fire the Attack word, hit or defend a Shot, set damage, set Paces, from the panel.

## What the game must still decide (not in this layer)

Menus and win / game-over screens, sound, and the player settings screen. The hit / damage rules and how a Match ends are decided and live in the [Match rules engine](match-engine.md); word selection, networking and Practice's word spawning are separate tickets. The two rules the user already set: **defending comes first** (above) and **Pace counts only the letters of correct words**.
