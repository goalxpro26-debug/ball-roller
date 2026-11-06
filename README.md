# Rolling Rush: Sky Tracks

An original HTML5 rolling-ball platformer. Steer Pip — a striped rolling
orb — along narrow sky tracks, over gaps, ramps, spikes and sliding
movers, to the finish flag. 20 levels, increasing difficulty, coins that
unlock new ball skins, and five themed environments.

Mechanics only are inspired by the rolling-ball platformer genre. Nothing
is copied from Going Balls or any other game: the title, character, art,
music and code are all original.

## Files

- `index.html` — the whole game. Plain HTML5 + vanilla JS + Canvas,
  single self-contained file. No engine, no external assets, no network
  needed. All art is drawn procedurally on canvas; all sound is
  synthesised with WebAudio.
- `test.js` — headless Playwright test (real mouse clicks + real keyboard
  input + an in-page key-event driver for the playthrough). See
  "How it was tested" below.
- `test-results.log` — output of the final full test run (16/16 checks).
- `test-shots/` — screenshots taken by the test run (menu, level 1,
  level-clear, paused, level 10, level 20, win screen) plus the persistent
  Chromium profile the test uses (`profile/`).

## How to run

Open `index.html` in any modern browser (desktop or mobile). No build
step, no server required. Or serve it locally:

```
cd ball-roller
python3 -m http.server 8000
# then open http://localhost:8000/
```

## How to play

- **Steer:** Left/Right arrow keys (or A/D), or the ◀ ▶ touch buttons.
- **Jump:** Space / Up / W, or the JUMP touch button. Releasing jump
  early makes a shorter hop (variable jump height). Coyote time (0.15 s)
  and jump buffering (0.2 s) are forgiving at track edges.
- **Pause:** P or the Pause button. **Mute:** M or the Sound button.
- Fall off a track or hit a spike/mover and you lose a life and respawn
  (at the start, or at the mid-level checkpoint flag once passed).
  3 lives per run; losing them all ends the run (retry the level).
- **Coins:** +100 each; coin arcs hang over gaps. **Level clear:**
  +500 plus a time bonus. 1–3 stars per level by lives left.
- **Unlocks:** coins buy ball skins — Pip (0), Berry (10), Mint (25),
  Ocean (45), Ember (70), Galaxy (100). Progress, coins and the highest
  unlocked level persist in `localStorage`.
- **Themes:** one per 4 levels — Dawn Meadow, Sunset Dunes, Twilight
  Peaks, Neon Night, Frost Ridge.

## Levels

20 levels, generated deterministically (seeded RNG, same layout every
play). Difficulty scales: wider gaps, narrower tracks, more segments,
spikes from level 3, sliding movers from level 5, steeper height steps.
Levels are short; falling restarts the level (or from the checkpoint).

## How it was tested

Tested headlessly with Playwright + headless Chromium, using **real**
input: real coordinate mouse clicks on buttons (Playwright's
`page.click()` never resolves in this headless build) and real keyboard
events for steering/jumping, plus an in-page driver that dispatches real
`KeyboardEvent`s to `window` for the 20-level autopilot playthrough.
Final run: **16/16 checks passed, zero page/console errors.**

| Check | Result |
|---|---|
| Loads, hook present, menu screen | PASS |
| How-to overlay opens | PASS |
| Start → playing level 1, 3 lives | PASS |
| Real keyboard Space makes Pip jump (jumps 0 → 1) | PASS |
| Falling in a gap costs 1 life and respawns | PASS |
| Autopilot clears level 1 → clear screen (20/25 coins, score 2711) | PASS |
| Next → playing level 2, score kept | PASS |
| Pause → paused screen | PASS |
| Resume → playing | PASS |
| Mute toggles on | PASS |
| Mute toggles off | PASS |
| Pause menu → menu screen | PASS |
| Level select → level 1 playing | PASS |
| Full playthrough reaches WIN after 20 levels | PASS — final score **68,604**, 1,825 coins, 2 lives left, 11 deaths, 328 jumps |
| Play again → level 1 playing, score reset | PASS |
| No page/console errors | PASS |

The playthrough log counts 19 "clear" screens plus the win screen:
level 20 goes straight to the win screen instead of a level-clear screen,
so 19 + 1 = all 20 levels. Level 15 needed a second attempt; every other
level cleared first try in the final run.

Level 20 was also verified separately (probe runs) after a fix: it clears
with 0 deaths, 3 lives, on the win screen.

### Environment quirks found while testing

- This headless Chromium produces **zero `requestAnimationFrame`
  callbacks**, so the game loop runs on `setInterval(tick, 16)` with
  fixed 1/60 s physics steps; canvas draws every 2nd tick (~30 fps) to
  avoid starving the event loop in SwiftShader.
- CDP `page.evaluate` round-trips take 1–9 s under VM load, so the
  autopilot driver runs inside the page. Browser launch needs the
  Hatch WebGL policy flags (see `test.js`).

### Bugs found and fixed during testing

- Track-generation `x` started at −40 instead of the start track's end
  (280), overlapping segments.
- Landing tolerance: a ball arriving slightly below a higher track's
  surface fell through it (snap-up tolerance 20 px + centre-above
  condition, later relaxed to centre ≤ 7 px below for fast descents).
- Spikes/movers sat in the gap-jump landing corridor; they now only sit
  ≥ 210 px into ≥ 370 px tracks, ≥ 130 px before the end.
- Short (150 px) tracks could be overshot entirely by a full jump when
  the next drop was steep; minimum track width raised to 200 px, max
  height step capped at 60 px.
- A spike and a mover could share one track, so hopping the spike landed
  on the mover; hazards now share one pool of long tracks (every 3rd
  track), one hazard per track, demand interleaved so both types stay
  present.
- Movers slid too fast at high levels; slide speed no longer scales with
  level, and the autopilot hops movers earlier (100 px) than spikes
  (80 px).

## Nothing was submitted anywhere

This is a build-only deliverable. No portal, store, or submission was
attempted.
