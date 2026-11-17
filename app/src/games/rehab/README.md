# Mirror Rehab games

Three rehab games for the two-way smart mirror, built from *Mirror Rehab Games: Cursor Prompts* (Nov 10, 2026). They run on one shared core inside the Body Motion app:

| Game | Folder | Trains | View | Levels |
|---|---|---|---|---|
| Fruit Catcher | `squat/` | Squat strength and form | Front or side (+ six side styles) | 5 per view |
| Cross-Over Bubbles | `bubbles/` | Correct hand, reaction time, crossing the midline, dual task | Front (standing or seated) | 5 |
| March to the Beat | `march/` | Gait rhythm, hip flexion, symmetry | Front | 5 |

## Run it

1. `cd app && npm run dev` (or `npm run electron:dev` for the kiosk).
2. On the mirror home, choose **Game**, then **Rehab games**.
3. With no camera or no person, open the gear (bottom right), set **Pose source → Mock**, go back, and turn on **Scripted demo** in the mock panel. Every game then plays itself. The sliders, toggles and the draggable wrists and ankles let you test each rule by hand.

Keys: arrows move between buttons, Enter presses, Esc exits or goes back, Space pauses in play, D toggles the debug skeleton. On the alignment screen the arrows move and `+`/`-` scale.

## Where things are

Pure logic, no DOM or Three.js (testable with Vitest), lives in `vision/games/rehab/`:

- `core/`: geometry, One-Euro smoothing, `RehabTracker` (one-person lock, tracking health, front/side view detection, automatic base pose, slow re-base), the mock skeleton, and `config.json`.
- `squat/`: `math.ts` (measurements), `form.ts` (form checks), `rep.ts` (rep state machine, sets, rest, score, stars, metrics), `levels.json`, `config.json`.
- `bubbles/game.ts`: reach-safe spawning, pop judging by the rule at touch time, rule rotation, level 5 marching gate, score, metrics. Config in `levels.json`, `rules.json` and `config.json`.
- `march/`: `measure.ts` (foot height, knee rise, drift), `game.ts` (seeded patterns, bar judging, safety pauses, assist mode, metrics). Config in `levels.json`, `patterns.json` and `config.json`.

The app side lives in `app/src/games/rehab/`:

- `core/engine.ts`: session flow (base pose → Ready → 3-2-1 → play → result) with automatic pause on lost tracking or the wrong view, plus the Pause, safety pause and Hurts paths.
- `core/display.ts`: mirrored image → screen → Three.js world (one world unit = the patient's leg length).
- `core/render.ts`: black renderer, glow-line helpers, particle bursts, trails.
- `core/audio.ts`: WebAudio synth effects and the lookahead beat scheduler.
- `core/storage.ts`: IndexedDB session log, best stars, CSV export.
- `core/settings.ts`: alignment, sound, latency, leg factors, assist mode, pose source, last choices.
- `core/providers.ts`: mock and WebSocket pose providers. The camera goes through the app's existing `VisionManager`.
- `<game>/<game>Module.ts`: the Three.js scene and the `GameModule` / `GameSession` wrapper.
- `registry.ts`: the list the home screen shows.

The UI lives in `app/src/components/screens/MirrorRehabScreen.tsx` and `app/src/components/rehab/`.

## Add a game

1. Put pure logic in `vision/games/rehab/<id>/`, with its numbers in JSON.
2. Add `app/src/games/rehab/<id>/<id>Module.ts` exporting a `GameModule` (see `core/module.ts`).
3. Add one line to `registry.ts`.

## Tests

From `app/`:

```
npx vitest run ../vision/games/rehab src/games/rehab src/components/rehab
```

- `vision/games/rehab/core/tracking.test.ts`: view detection, base pose lock, re-base rules, tracking health, person lock and re-lock, toe-out.
- `vision/games/rehab/squat/*.test.ts`: every measurement at the doc's hip drops and leans (both views, both legs), the form checks, and the Fruit Catcher loophole tests.
- `vision/games/rehab/bubbles/game.test.ts`: hand and midline mapping, reach-safe spawning, the bubble loophole tests and a full round at every level.
- `vision/games/rehab/march/game.test.ts`: foot measurements, patterns and the March loophole tests on a fake clock, plus the demo clearing every bar and flat feet clearing none.
- `app/src/games/rehab/core/engine.integration.test.ts`: the real engine and game sessions in Node (WebGL, audio and storage faked): pauses, wrong view, Hurts, Exit, hover menus, camera latency and every game's scripted demo end to end.
- `display.test.ts`, `audio.test.ts`, `registry.test.ts` and `components/rehab/RehabHome.test.tsx`: display mapping, the beat clock, the plugin registry and the home screen.

`vision/games/rehab/testing/rig.ts` and `app/src/games/rehab/testing/` hold the shared test drivers.

## Tune without code

Every threshold, timing, tolerance, colour and level lives in JSON. Edit and reload:

- Core: `vision/games/rehab/core/config.json` (visibility, leg-on-screen range, base pose stillness, view ratios, smoothing, hover dwell times).
- Fruit Catcher: `squat/levels.json` (depths, fruit, holds, tempos, checks, styles, reps, sets, rest) and `squat/config.json` (form bands).
- Bubbles: `bubbles/levels.json`, `bubbles/rules.json`, `bubbles/config.json`.
- March: `march/levels.json` (BPM, heights, windows), `march/patterns.json` and `march/config.json` (judging rules; `music.url` and `music.bpm` play an mp3 instead of the built-in beat).

## WebSocket pose input

Set **Pose source → WebSocket**. The app connects to `ws://localhost:8765` and expects one JSON message per frame:

```json
{ "t": 12.34, "aspect": 1.7778, "people": [{ "landmarks": [{ "x": 0.5, "y": 0.4, "z": 0, "visibility": 0.99 }], "worldLandmarks": [] }] }
```

`landmarks` must be the 33 MediaPipe pose points, normalized and not mirrored. Only the first person is used.

## Choices made where the doc left room

- **Built into this app, not as a separate Vite app.** The app already had the mirror shell, the MediaPipe pipeline and a Games menu, so the "shared core" reuses them. Pose runs at 30 fps while these games are open (`VisionManager.setPosePreviewFps`). The rest of the app keeps 15 fps.
- **One-person lock.** The pose model here returns one person. The tracker rejects frames that jump in position or size, or that move away from where the base pose was taken. Size is compared by torso length and by leg segment length, whichever is closer to the base, so turning, squatting and bowing never look like a different person. After 3 s without the locked person it re-locks and takes a new base pose.
- **Slow re-base.** Only while still and tall, and only when leg length, torso length and hip height are each within 5% and both feet are flat (heel-to-toe and left-against-right floor line within 1% of leg length). A held bow, raised heels or a lifted foot is never absorbed into the base.
- **Leg-on-screen health check.** After the base locks, this uses the base leg length at the live body size, because squatting shortens hip-to-ankle.
- **Display alignment.** A linear fit (mirror x, offset, scale) set on the alignment screen, as the doc describes. It does not use the physical mirror projection the exercise wireframe uses.
- **Fruit Catcher.**
  - "Strict" (F5, S5) halves every borderline band.
  - Back, shin and tibia ranges describe the bottom of the squat, so before depth only their upper limits are judged (too much lean or knee travel). A caving knee is judged at all times.
  - Levels with a free tempo judge lowering speed against `freeTempoDownSeconds` (1 s).
  - A rep needs both the fruit count and the hold time.
  - Spilled reps count toward the set.
  - The heel check runs at the top on every level, so lifting the heels stops the basket emptying.
- **Bubbles.**
  - Pause (tracking lost, Pause, Hurts) stops spawns, the round timer, rule changes and bubble ages.
  - Wrists and fingertips are not tracking requirements, so one hidden hand never pauses the game. With both hands hidden it shows "Show your hands".
  - Gold bubbles carry a blue or red inner ring for the hand that pops them.
  - While a rule change is announced, the card shows the next rule under the current one.
  - "Crossing success" counts bubbles that were crossing when they spawned.
- **March.**
  - Lean, jump and "no lift for 10 s" pauses need **Resume** (tap or hover).
  - The stance rule only flags jumps (both feet above 8% for 0.15 s). The other foot rising a little inside the window is allowed at fast tempos.
  - Knee-rule failures cue "Lift your knee up".
  - A lift that cleared a bar is spent: the foot must come back down before it can clear another bar on the same leg.
  - Assist mode switches tempo at the next unscheduled bar. The beat track switches at the same song time and the song clock never jumps. With an mp3 track the music keeps its own tempo.
- **Main Games menu.** It has one entry, "Rehab games". The rehab home lists the three games.
- **No throwaway demo game (C7).** The three real games already prove the plugin interface.

## Open question from the doc

The doc asks whether each game needs a short in-mirror tutorial or whether the therapist explains it. There is no tutorial yet.
