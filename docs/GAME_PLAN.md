# BracketBot Robotics Game — Design and Implementation Plan

> **This document is the single direction for the project from 2026-09-12 on.**
> Older plans (rally robustness, shot challenge, learning-lab handoff) were removed;
> the existing lab and rally code stay in the repo as reference and reusable assets.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement Part B task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone browser game in which kids (ages 10–13) complete small tasks with
the *real* BracketBot model to learn PID control, the five stages of training an RL
ping-pong policy, and simple visual machine learning — with nothing faked, and every task
reproducible on the physical robot.

**Architecture:** One static web app (`game/`) — plain HTML/ES modules, Three.js (vendored)
rendering the original URDF meshes, three self-contained JS simulations (`sim/`) that do
real PID, real policy-gradient RL, and real softmax classification in the browser, and a
DOM overlay for controls. No server. Deployed with `higgsfield game deploy`; runs locally
with `python3 -m http.server`.

**Tech stack:** Vanilla JS ES modules, Three.js 0.184.0 (vendored), Draco decoder (vendored),
Node 26 built-in test runner for sims, Playwright (already in `web/`) for browser checks,
Python 3.12 + numpy for the URDF bake tool, Higgsfield CLI for generated assets and deploy.

**Spirit (from `note.md`):** game-ish, small completable tasks, kids gain a basic
understanding of robotics through BracketBot, every virtual task reproducible in the real
world. The robot never pretends: training and classification are genuine.

---

## Part A — Design

### A1. Game profile

| Axis | Choice |
|---|---|
| Time | Real-time sims inside pause-at-will task steps |
| Space | Continuous 3D scene (Three.js), 1-D / 2-D physics under it |
| Agency | Disembodied engineer's hand — the player tunes, labels, chooses; BracketBot acts |
| Conflict | vs system (disturbances, unseen serves, tricky images) |
| Content | Authored task chain, seeded procedural instances |
| Outcome | Per-level win (badge); no lose state, only retry |
| Players | Solo |
| Session | 10 min per level, ~30 min total |
| Engagement | Discovery (what does this knob do?) + calculation (what reward teaches what?) |
| Platforms | Desktop keyboard/mouse, phone touch, gamepad (menu navigation only) |
| Language | English; all strings in `strings.js` |

**Experience formula:** *The player feels like a robot engineer because every knob they turn
visibly changes what BracketBot does, and the robot never pretends.*

### A2. Structure

```
Hub ─┬─ Level 1  Hold the Line   (PID)      5 steps → badge
     ├─ Level 2  Teach the Rally (RL)       5 steps → badge
     └─ Level 3  Robot Eyes      (Vision)   5 steps → badge
```

- Hub shows the three levels, progress (step n/5), badges, and a "Real robot" card per level.
- Levels unlock in any order (teachers may run one).
- Each step: one instruction line, the scene, only the controls that step needs, a pass
  check, then NEXT. Feedback stays on screen until the player presses NEXT (never auto-advance).
- Progress saved to `localStorage` (`bb-game-v1`): current step per level, gains, labels,
  trained models, badge flags. Reset button on the hub.
- Every level ends with a one-question concept check (multiple choice, retry allowed) and a
  "Try it on the real BracketBot" card (text from `docs/CLASSROOM_LABS.md`).

### A3. Level 1 — Hold the Line (PID)

Scene: BracketBot on a floor with a target marker; chassis moves along one axis via wheels
(wheel links spin with travel). Live graph (position vs target, 8 s) + P/I/D contribution bars.

Sim (`sim/pid.js`): 50 Hz control loop over a 1-D chassis model
`v' = (v_cmd − v)/τ − c·v + F/m`, `x' = v`, with `m = 20 kg`, `τ = 0.15 s`, `c = 0.5 s⁻¹`
(surrogate values; calibrated in Task 4 so the criteria below hold). PID exactly as the lab:
error = target − x; derivative on measurement, filtered `d = 0.72·d + 0.28·rate`; integral
clamped ±0.7 with anti-windup (only accumulate when output is not saturated or error opposes
output); output saturated to ±0.65 m/s; commanded wheel speed rate-limited 0.8 per tick.
Gains bounded: `kp ∈ [0, 8]`, `ki ∈ [0, 2]`, `kd ∈ [0, 4]`. Reference gains (3.2, 0.35, 1.1).

Disturbances (N, start s, end s): push (230, 0.65, 0.73); long push (70, 0.65, 1.25);
steady pull (22, 0.65, 7.4). Trial = 8 s. Stable = |error| ≤ 5 cm over the last 2 s.

| Step | Player does | Pass |
|---|---|---|
| 1 See the error | Run with all gains 0, push | Trial ran; player pressed NEXT |
| 2 Add P | Slide P, run push | Any run with kp > 0 |
| 3 Add D | Slide D, run push | A run with kd > 0 whose max overshoot < the best P-only run |
| 4 Add I | Steady pull; slide I | A run with ki > 0 whose final error < 5 cm |
| 5 Exam | One gain set must pass all three disturbances | All three stable with identical gains |
| Concept | "Which gain removes a slow, steady offset?" → I | Correct answer |

After three failed exam attempts, show the reference gains as a hint; the player must still run.

### A4. Level 2 — Teach the Rally (RL)

Scene: side view of the table; BracketBot at the near end; ball served from the far end.
Paddle height maps to the mast carriage (`rj0`), paddle tilt to the wrist (`rj5`) — visible
arm motion for every attempt.

Sim (`sim/rally.js`): 2-D ball (x forward, y up), gravity 9.81, one bounce on the robot's
half, paddle plane at `x = 0`. One episode = one serve. Serve is seeded: speed ∈ [3, 5] m/s,
launch angle ∈ [−5°, 12°], from `x = 2.4, y = 1.0`.
Observation (what the robot senses, 4 values): ball `x, y, vx, vy` at serve time.
Action (what the robot controls): paddle height ∈ 5 levels × tilt ∈ 3 angles = 15 discrete
actions. Contact = ball crosses the paddle plane within ±8 cm of the paddle center. Legal
return = after contact the ball (reflected with tilt-dependent angle, 0.8 restitution)
clears the net (`x = 1.37, y ≥ 0.15`) and lands on the far half (`x ∈ [1.37, 2.74]`).

Policy: linear softmax over 15 actions on features `[1, x, y, vx, vy]` (75 weights), trained
with REINFORCE + running-mean baseline, `lr = 0.05`, seeded init 0, 300 episodes per "Train"
(shown at 20 episodes/s with the arm animating; can be cancelled). Reward presets:
`contact = {contact: 8, success: 2, failure: −1}`, `return = {contact: 2, success: 10, failure: −2}`
(same numbers as the lab). Reward and outcome counts (contacts, legal returns) are always shown
side by side. Training is genuine and may not improve much in 300 episodes; the level says so.

Evaluation: fixed 20-serve "classroom comparison set" (seed 777), before (fresh policy) vs after.

| Step | Player does | Pass |
|---|---|---|
| 1 Set the task | Pick the successful outcome from 3 replays (miss / touch into net / legal return) | Correct pick |
| 2 Senses & controls | Drag 6 cards into "Robot senses" / "Robot controls" | All 6 correct |
| 3 Choose reward | Toggle presets; see 3 fixed outcomes scored under each | Player viewed both, pressed NEXT |
| 4 Train | Press TRAIN; watch 300 episodes; may train again or switch preset (restarts from fresh) | One run completed |
| 5 Evaluate | Run before/after on 20 unseen serves | Ran once |
| Concept | "Which number proves the robot returns balls?" → legal returns, not reward | Correct answer |

### A5. Level 3 — Robot Eyes (Vision)

Scene: BracketBot's head camera view (a framed 2-D "photo" panel beside the 3D robot; the head
link nods toward the sample). Samples are procedural "photos": background colour, centred
object (circle with radial shading), lighting multiplier; deterministic from seed 11.
Feature = mean RGB of the centre 40 % crop, divided by 255.

Classifier (`sim/vision.js`): linear 3→3 softmax, cross-entropy, SGD `lr = 0.45`, weight decay
0.002, 180 epochs, fixed init (seed 7). Requires ≥ 2 examples per class. Same as the lab.

Sets: train 18 (6 per class), test 12 (4 per class, different backgrounds/lighting), improve 6
(hard cases: dim yellow on warm background, purple-leaning blue, orange-leaning red).

| Step | Player does | Pass |
|---|---|---|
| 1 Label | Tap each of 18 photos → red / blue / yellow | All 18 labelled, ≥ 2 per class |
| 2 Train | Press TRAIN | Model trained (accuracy shown) |
| 3 Test | Reveal 12 predictions; per-class correct counts | Viewed, pressed NEXT |
| 4 Improve | Label 6 harder photos, retrain, compare on the same 12 | Retrained |
| 5 Real object | Upload/take a photo (`<input type=file accept=image/* capture=environment>`); centre-crop → prediction + scores | One prediction shown |
| Concept | "Why test on photos the robot never saw?" → to know if it learned the colour, not the photos | Correct answer |

### A6. Robot model

`tools/bake_urdf.py` reads `chopped_urdf_v2/chopped_urdf_v2/urdf/chopped_urdf_v2.urdf` and
writes `game/assets/robot/robot.json`:

```json
{ "links": [ { "name": "shoulder__shoulder", "parent": "arm_base",
               "joint": { "name": "rj0", "type": "prismatic", "lower": -1.03044, "upper": 0, "mimic": null },
               "xyz": [x, y, z], "rpy": [r, p, y],
               "mesh": "Shoulder__Shoulder.glb", "color": [0.8, 0.8, 0.8] } ],
  "check": { "right_eef": [x, y, z], "left_wheel_tire__left_wheel_tire": [x, y, z] } }
```

All joint axes are `(0,0,1)` (verified in the URDF), so a joint value is a rotation (or
translation) about the child's local Z after the origin transform. URDF `rpy` is fixed-axis
XYZ, i.e. `R = Rz(y)·Ry(p)·Rx(r)` → `new THREE.Euler(r, p, y, 'ZYX')`. The `check` block
is forward kinematics at zero pose computed in Python; a Node test asserts the JS loader
reproduces it (catches convention errors). The 54 Draco GLBs are copied from
`chopped_urdf_v2/chopped_urdf_v2/draco/` (872 KB).

### A7. Assets (`game/design/assets.csv`)

Generated with Higgsfield (Task 12), all under one STYLE FORMULA chosen with the user:

| id | role | type |
|---|---|---|
| tex_floor | floor tile | tileable texture 1024² |
| tex_table | table top | tileable texture 1024² |
| spr_badge_pid / rl / vision | hub badges | sprite 512² |
| spr_hub_bg | hub background | image 16:9 |
| sfx_click, sfx_pass, sfx_fail, sfx_hit, sfx_bounce | UI/game SFX | audio |
| music_hub | hub loop | audio, ≤ 60 s |

Robot meshes, ball, target marker, net, graphs and cards are code/URDF, not generated.
If Higgsfield generation is unavailable, Task 12 substitutes procedural canvas textures and
Web-Audio-synthesised SFX so the game still ships complete.

### A8. Files

```
game/
  index.html          page: importmap, canvas, overlay root, module entry
  logic.js            platform stub (solo)
  strings.js          every player-visible string
  main.js             boot: state → hub/level router → scene + overlay
  state.js            localStorage progress (load/save/reset)
  rng.js              seeded PRNG (mulberry32)
  robot.js            robot.json → THREE.Group tree; setJoint(name, value)
  scene.js            renderer, camera, lights, floor/table, resize, DPR cap, dev overlay
  ui.js               DOM overlay helpers: panel, button, slider, cards, graph canvas
  audio.js            SFX/music playback (unlock on first input)
  hub.js              hub screen
  levels/pid.js       Level 1 flow (uses sim/pid.js)
  levels/rl.js        Level 2 flow (uses sim/rally.js)
  levels/vision.js    Level 3 flow (uses sim/vision.js)
  sim/pid.js          pure sim: runTrial(gains, disturbance) → {trajectory, metrics}
  sim/rally.js        pure sim: serve(rng), simulate(serve, action), Policy, train(), evaluate()
  sim/vision.js       pure: makeSamples(), features(), train(), predict()
  vendor/three/       three.module.js, loaders/GLTFLoader.js, loaders/DRACOLoader.js,
                      utils/BufferGeometryUtils.js, utils/SkeletonUtils.js, libs/draco/gltf/*
  assets/robot/       robot.json + 54 .glb
  assets/             generated textures, sprites, audio
  design/assets.csv   asset manifest
  tools/bake_urdf.py  URDF → robot.json
  tests/*.test.mjs    node --test unit tests for sim/, rng, state, robot FK
  tests/browser.mjs   Playwright full-flow check (3 levels, reload, phone viewport)
```

### A9. Quality gates

- Unit: `node --test game/tests` — sims deterministic, criteria achievable, FK matches Python.
- Browser: `node game/tests/browser.mjs` against `python3 -m http.server 8000` — all three
  levels start→badge, reload keeps progress, no console errors, phone viewport 390×844
  touch-only playable, no 404s.
- Performance: ≥ 60 fps desktop / ≥ 30 fps phone on the rally scene (dev overlay `?dev=1`),
  DPR capped 1.5, shadows off on phones, robot loaded once.
- Deploy: `higgsfield game deploy` returns a URL; smoke path re-run on the URL.

### A10. Out of scope (v1)

Webcam live stream (photo upload/capture covers the objective), multiplayer, physical robot
control, MuJoCo/PPO in the browser, leaderboards, accounts.

---

## Part B — Implementation Plan

### Global constraints

- Node ≥ 26 (built-in `node --test`), Python 3.12 + numpy (`.venv/bin/python`), Three.js **0.184.0** copied from `web/node_modules/three`.
- No CDN links; all references relative (`./…`); keyboard bindings by `event.code`.
- Every player-visible string lives in `game/strings.js`.
- Fixed-timestep sims with seeded RNG; no allocations in the render loop.
- Commit after every task; commit messages `game: <what>`.
- Run tests from repo root: `node --test game/tests`.

### Task 1: Scaffold, seeded RNG, state persistence

**Files:** Create `game/index.html`, `game/logic.js`, `game/strings.js`, `game/rng.js`, `game/state.js`, `game/main.js`, `game/tests/rng.test.mjs`, `game/tests/state.test.mjs`

**Produces:** `rng(seed) → () => float in [0,1)`, `rng.int(n)`, `rng.range(a,b)`; `loadState()`, `saveState(s)`, `resetState()`, `defaultState()` with shape `{version:1, levels:{pid:{step:1,done:false,gains:{kp:0,ki:0,kd:0}}, rl:{step:1,done:false,preset:'contact',policy:null}, vision:{step:1,done:false,labels:{},model:null}}}`.

- [ ] Write `game/tests/rng.test.mjs`:
```js
import test from 'node:test'; import assert from 'node:assert/strict';
import { rng } from '../rng.js';
test('same seed same sequence', () => { const a = rng(5), b = rng(5); for (let i = 0; i < 20; i++) assert.equal(a(), b()) })
test('range and int stay in bounds', () => { const r = rng(1); for (let i = 0; i < 1000; i++) { const v = r.range(2, 3); assert.ok(v >= 2 && v < 3); const n = r.int(4); assert.ok(n >= 0 && n < 4 && Number.isInteger(n)) } })
```
- [ ] Run `node --test game/tests` → FAIL (module missing).
- [ ] Write `game/rng.js` (mulberry32):
```js
export function rng(seed) {
  let a = seed >>> 0
  const next = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  next.range = (lo, hi) => lo + (hi - lo) * next()
  next.int = n => Math.floor(next() * n)
  return next
}
```
- [ ] Write `game/tests/state.test.mjs` using a fake `localStorage` (`globalThis.localStorage = { store:{}, getItem(k){return this.store[k] ?? null}, setItem(k,v){this.store[k]=v}, removeItem(k){delete this.store[k]} }`): assert `loadState()` returns `defaultState()` when empty, round-trips after `saveState`, and returns defaults (not throws) for corrupt JSON or a different `version`.
- [ ] Write `game/state.js` (key `bb-game-v1`, try/catch around every storage call).
- [ ] Write `game/logic.js` (the platform stub from the Higgsfield build reference, `meta.game = "bracketbot-robotics"`), `game/strings.js` (`export const STR = { hub: { title: 'BracketBot Robotics', … } }` — fill as levels are built), `game/index.html` (viewport meta, `<canvas id="c">`, `<div id="ui">`, `<div id="dev" hidden>`, importmap `{"imports":{"three":"./vendor/three/three.module.js"}}`, `<script type="module" src="./main.js">`), `game/main.js` (loads state, renders "hello" text from `STR` into `#ui`).
- [ ] Run `node --test game/tests` → PASS. Serve `cd game && python3 -m http.server 8000`, open, confirm text and no console errors.
- [ ] Commit: `game: scaffold with seeded rng and persisted state`.

### Task 2: URDF bake tool and robot.json

**Files:** Create `game/tools/bake_urdf.py`, `game/assets/robot/robot.json`, copy `chopped_urdf_v2/chopped_urdf_v2/draco/*.glb` → `game/assets/robot/`.

**Produces:** `robot.json` per A6 (link order = parents before children; joint `type` ∈ fixed|revolute|prismatic; `mimic` = `{joint, multiplier, offset}` or null; `mesh` = GLB basename or null; `color` from `<material><color rgba>`; `check` = zero-pose world positions of `right_eef`, `left_eef`, `left_wheel_tire__left_wheel_tire`, `head__head__head__head` computed with numpy: `T = Trans(xyz)·Rz(y)·Ry(p)·Rx(r)` per joint).

- [ ] Write `game/tools/bake_urdf.py` with `argparse` (`--urdf`, `--out`), `xml.etree`, numpy FK; mesh name = `Path(filename).stem + '.glb'`; assert each GLB exists in the draco dir; print link/joint counts.
- [ ] Run `.venv/bin/python game/tools/bake_urdf.py --urdf chopped_urdf_v2/chopped_urdf_v2/urdf/chopped_urdf_v2.urdf --out game/assets/robot/robot.json` → prints `54 links, 53 joints`; copy GLBs.
- [ ] Add `game/tests/robot_json.test.mjs`: parse `robot.json`, assert 54 links, exactly one link with `parent === null` named `root`, 18 non-fixed joints, every non-null `mesh` file exists under `game/assets/robot/`.
- [ ] `node --test game/tests` → PASS. Commit: `game: bake URDF into robot.json and ship draco meshes`.

### Task 3: Vendor Three.js and build the robot tree

**Files:** Copy from `web/node_modules/three/`: `build/three.module.js` → `game/vendor/three/three.module.js`; `examples/jsm/loaders/{GLTFLoader,DRACOLoader}.js` → `game/vendor/three/loaders/`; `examples/jsm/utils/{BufferGeometryUtils,SkeletonUtils}.js` → `game/vendor/three/utils/`; `examples/jsm/libs/draco/gltf/*` → `game/vendor/three/libs/draco/gltf/`. Create `game/robot.js`, `game/scene.js`, `game/tests/robot_fk.test.mjs`.

**Produces:** `buildRobot(json, { loadMesh }) → { group, setJoint(name, value), joints: Map }` where `loadMesh(file) → Promise<THREE.Object3D>|null` (null skips meshes, used by tests); `createScene(canvas) → { renderer, scene, camera, resize(), render(), setDev(bool) }`.

- [ ] Write `game/tests/robot_fk.test.mjs`: import `three` via `../vendor/three/three.module.js`, `buildRobot(json, { loadMesh: () => null })`, `group.updateMatrixWorld(true)`, for each name in `json.check` get the link's world position, assert each coordinate within 1e-6 of the Python value. Second test: `setJoint('rj0', -0.5)` moves `right_eef` down by exactly 0.5 in the shoulder's local Z (compare world Z delta with the parent's Z axis in world).
- [ ] Run → FAIL. Write `game/robot.js`: per link create `origin = new Group()` with `position.set(...xyz)`, `rotation.set(r, p, y, 'ZYX')`, child `jointGroup = new Group()` (rotation.z or position.z = joint value), attach mesh under `jointGroup` (material `MeshStandardMaterial({ color })`), map mimic joints on `setJoint`.
- [ ] Run → PASS. Write `game/scene.js` (WebGLRenderer antialias, DPR cap 1.5, PerspectiveCamera 40°, hemisphere + directional light, floor mesh, `resize` on `resize`/`orientationchange`, `render()` only; no rAF loop here) and wire `main.js` to load `robot.json` + GLBs with `GLTFLoader` + `DRACOLoader.setDecoderPath('./vendor/three/libs/draco/gltf/')` and show the robot idle.
- [ ] Serve and confirm: the real BracketBot renders (mast, arms, wheels), no 404s, `?dev=1` shows fps. Commit: `game: vendor three.js and render the original BracketBot`.

### Task 4: PID simulation (pure) and calibration

**Files:** Create `game/sim/pid.js`, `game/tests/pid.test.mjs`.

**Produces:** `DISTURBANCES` (A3), `GAIN_LIMITS = {kp:[0,8], ki:[0,2], kd:[0,4]}`, `REFERENCE_GAINS = {kp:3.2, ki:0.35, kd:1.1}`, `runTrial(gains, disturbanceId, seconds = 8) → { trajectory: [{t, x, output, p, i, d}], metrics: { maxErrorCm, finalErrorCm, tailErrorCm, stable, overshootCm } }`, `stepChassis(state, vCmd, force, dt)` for the live scene.

- [ ] Write tests: (1) reference gains stable on all three disturbances; (2) `{kp:1,ki:0,kd:0}` on steady pull → `finalErrorCm > 5`; (3) `{kp:8,ki:0,kd:0}` on push → `overshootCm > 0` and not stable; (4) `{kp:8,ki:0,kd:2}` overshoot < case 3; (5) determinism: two runs equal; (6) gains outside limits throw.
- [ ] Run → FAIL. Implement `sim/pid.js` with the model and PID from A3 (`dt = 0.02`, 400 ticks). If a criterion test fails, tune `m`, `τ`, `c` **one at a time** (record final values in the file header comment); never change the PID law or the gain limits.
- [ ] Run → PASS. Commit: `game: pid chassis sim calibrated to lesson criteria`.

### Task 5: UI overlay kit, hub, and audio shell

**Files:** Create `game/ui.js`, `game/hub.js`, `game/audio.js`; modify `game/main.js`, `game/strings.js`.

**Produces:** `ui.panel({title, body, actions})`, `ui.button(label, onClick, {primary})`, `ui.slider({label, min, max, step, value, onInput})`, `ui.choice(options, onPick)`, `ui.cards(items, zones, onDrop)` (drag on pointer events, works with touch), `ui.graph(canvas, series, {yRange})`, `ui.toast(text)`; `showHub(state, { openLevel })`; `audio.play(id)`, `audio.music(id|null)`, unlock on first `pointerdown`/`keydown`.

- [ ] Build `ui.js` with DOM only, all text passed in from `STR`; focusable buttons (`Enter`/`Space` via `event.code`), gamepad D-pad moves focus, button 0 activates (polled in `main.js` loop).
- [ ] Build `hub.js`: three level cards with `step n/5` or badge, "Real robot" card link per level, reset progress button (two-tap confirm), keyboard/touch reachable.
- [ ] Wire `main.js`: `router({ hub, pid, rl, vision })`, start rAF loop that renders the scene and polls gamepad; `blur` pauses.
- [ ] Serve; confirm hub at 1440×900 and 390×844 (nothing overflows; buttons ≥ 44 px). Commit: `game: ui kit, hub and audio shell`.

### Task 6: Level 1 — Hold the Line

**Files:** Create `game/levels/pid.js`; modify `game/strings.js`, `game/tests/browser.mjs` (create).

**Consumes:** `runTrial`, `stepChassis`, `buildRobot.setJoint`, `ui.*`, state.

- [ ] Implement the five steps and concept check from A3. Live run: play the trajectory at 1× over 8 s, chassis `group.position.x = x`, wheel joints `left_wheel/right_wheel` rotate by `x / 0.0846` (add these two links to `setJoint` handling as plain revolute about the wheel axis — find the wheel tire links in `robot.json` and rotate their `jointGroup`), graph updates each frame, P/I/D bars from the trajectory point. Pass logic exactly per A3 table; store `gains` and `step` in state after every run; exam hint after 3 failed attempts.
- [ ] Create `game/tests/browser.mjs` (Playwright, same structure as `web/scripts/verify-visual.mjs`): step "pid level start→badge" that drives the sliders with the reference gains, runs all three disturbances, answers the concept question, asserts the badge is shown and `localStorage` has `levels.pid.done === true`; reload → hub still shows the badge.
- [ ] Run `python3 -m http.server 8000` in `game/` and `node game/tests/browser.mjs` → PASS. Commit: `game: level 1 hold the line`.

### Task 7: Rally simulation and policy (pure)

**Files:** Create `game/sim/rally.js`, `game/tests/rally.test.mjs`.

**Produces:** `makeServe(rng) → {x,y,vx,vy}`, `ACTIONS` (15 `{height, tilt}`), `simulate(serve, action) → { contact, legal, path: [{x,y}] }`, `PRESETS`, `rewardFor(outcome, preset)`, `Policy` (`new Policy(seed)`, `act(obs, rng) → index`, `probs(obs)`), `trainEpisode(policy, rng, preset) → outcome`, `train(policy, {episodes, preset, seed, onEpisode}) → {rewards[], contacts, legal}`, `evaluate(policy, seed = 777, n = 20) → {contacts, legal, outcomes[]}`.

- [ ] Write tests: (1) `simulate` deterministic; (2) an oracle that picks the best of 15 actions per serve achieves `legal ≥ 16/20` on the eval set (proves the task is solvable); (3) a fresh policy scores `legal ≤ 6/20` (proves learning is needed); (4) 300 episodes with preset `return` at seed 1 improves `legal` on eval vs. fresh by ≥ 4 (calibrate lr/feature scaling until true for seeds 1–3 — record); (5) preset `contact` yields `contacts ≥` preset `return` contacts but not necessarily legal returns (assert only `contacts ≥ 10/20`).
- [ ] Run → FAIL. Implement per A4 (ballistics with `dt = 1/240`, analytic crossing, reflection: outgoing angle = tilt-based; restitution 0.8). REINFORCE update: `w += lr * (R − baseline) * (onehot(a) − probs) ⊗ features`.
- [ ] Run → PASS. Commit: `game: rally sim with honest policy-gradient training`.

### Task 8: Level 2 — Teach the Rally

**Files:** Create `game/levels/rl.js`; modify `game/strings.js`, `game/scene.js` (table + net + ball meshes), `game/tests/browser.mjs`.

- [ ] Implement the five steps and concept check from A4. Step 1 replays three canned serves/actions (`ACTIONS[7]` miss, a contact-into-net action, a legal one). Step 2 six cards → two drop zones. Step 3 the same three outcomes scored under both presets, side by side. Step 4 TRAIN runs `train()` in chunks of 20 episodes per animation frame batch (never block > 16 ms), arm animates (`rj0` ← height, `rj5` ← tilt), counters: episode, reward (avg last 20), contacts, legal; CANCEL keeps what was learned; switching preset resets the policy (stated on screen). Step 5 before/after scoreboards, clearly labelled. Persist policy weights in state.
- [ ] Extend `browser.mjs`: "rl level start→badge" — completes steps 1–3 with correct picks, presses TRAIN, waits for 300 episodes, evaluates, answers the concept question, asserts badge; reload keeps step and badge.
- [ ] Run browser check → PASS. Commit: `game: level 2 teach the rally`.

### Task 9: Vision simulation (pure)

**Files:** Create `game/sim/vision.js`, `game/tests/vision.test.mjs`.

**Produces:** `LABELS`, `makeSets(seed = 11) → { train: Sample[18], test: Sample[12], improve: Sample[6] }` where `Sample = {id, truth, objectRGB, bgRGB, light}`, `renderSample(sample, ctx, size)` (canvas draw), `features(sample) → [r,g,b]` (analytic mean of the shaded centre crop — no canvas needed), `trainClassifier(samples: {features, label}[], {epochs=180}) → {weights, bias, accuracy}`, `predict(model, features) → {label, scores}`.

- [ ] Write tests: (1) `makeSets` deterministic and balanced; (2) training on correctly labelled train set → test accuracy ≥ 10/12; (3) training with `red`↔`blue` labels swapped flips predictions (labels matter); (4) < 2 examples for a class throws; (5) after adding the improve set, accuracy on `improve` ≥ 5/6.
- [ ] Run → FAIL. Implement per A5 (`Math.log`/`exp` softmax, SGD, seeded init).
- [ ] Run → PASS. Commit: `game: vision classifier sim`.

### Task 10: Level 3 — Robot Eyes

**Files:** Create `game/levels/vision.js`; modify `game/strings.js`, `game/tests/browser.mjs`.

- [ ] Implement A5: photo grid (canvas per sample, ≥ 96 px, tap cycles label; also three labelled buttons per photo for keyboard), TRAIN, test grid with ✓/✗ and per-class counts, improve grid + retrain + "before/after on the same 12", real-object step (`<input type=file accept="image/*" capture="environment">` → `createImageBitmap` → centre 40 % crop mean RGB → `predict`), concept check. Head link nods (`head__head__head__head` rotation) when a photo is selected. Persist labels and model.
- [ ] Extend `browser.mjs`: label all 18 by truth, train, test, label 6, retrain, upload a generated PNG (write a solid red 64×64 with Playwright `setInputFiles` buffer), assert prediction "red", answer concept, badge; reload keeps badge; final step: all three badges on hub.
- [ ] Run → PASS. Commit: `game: level 3 robot eyes`.

### Task 11: Real-robot cards, phone/touch pass, performance

**Files:** Modify `game/hub.js`, `game/levels/*.js`, `game/strings.js`, `game/scene.js`, `game/tests/browser.mjs`.

- [ ] Add per-level "Try it on the real BracketBot" card text (condensed from `docs/CLASSROOM_LABS.md`, including the safety lines) shown after the badge and reachable from the hub.
- [ ] Phone pass at 390×844: panels stack under the scene, scene height ≥ 40 % of viewport, all controls touch-reachable; disable shadows and cap DPR 1.0 when `innerWidth < 700`.
- [ ] Add to `browser.mjs`: phone viewport run of level 1 touch-only (Playwright `hasTouch: true`, taps only), and a dev-overlay fps read on the rally scene (assert ≥ 30 in headless; log the number).
- [ ] Run → PASS. Commit: `game: real-robot cards, phone layout, perf caps`.

### Task 12: Generated assets (Higgsfield) with procedural fallback

**Files:** Create `game/design/assets.csv`, `game/assets/*`; modify `game/scene.js`, `game/hub.js`, `game/audio.js`.

- [ ] Install CLI (`curl -fsSL https://raw.githubusercontent.com/higgsfield-ai/cli/main/install.sh | sh`); user runs `higgsfield auth login`; check `higgsfield game deploy --help`.
- [ ] Read the skill's `references/stylization.md`; propose 2 STYLE FORMULAS to the user (e.g. "clean workshop, soft daylight, matte plastics" vs "bright classroom poster, flat colours"); wait for the pick.
- [ ] Write `design/assets.csv` per A7; generate textures, sprites, SFX, music with `higgsfield generate create … --wait --json` (≤ 2 retries each); wire into scene/hub/audio.
- [ ] Fallback if the CLI or login is unavailable: `game/tools/procedural_assets.mjs` writes checker/noise PNG textures via a headless canvas (Playwright) and `audio.js` synthesises SFX with an oscillator; the manifest `source` column records `procedural`.
- [ ] Browser check → PASS with no 404s. Commit: `game: styled assets`.

### Task 13: Docs cleanup, README, deploy

**Files:** Modify `README.md`, `.gitignore`; create `game/README.md`; delete superseded docs (done in this commit if not already: `HANDOFF.md`, `PLAN.md`, `PLAY_DESIGN.md`, `RALLY_ROBUSTNESS_PLAN.md`, `RALLY_STATUS.md`, `TRAINING.md`, `HACKATHON_NOTES.md`).

- [ ] `README.md`: game first (run locally, tests, deploy), then the lab and rally/training as "also in this repo"; link `docs/GAME_PLAN.md` as the direction.
- [ ] `zip -r "$PWD/artifacts/bracketbot-game.zip" . -x '*.DS_Store' 'tests/*' 'tools/*'` from `game/`; `higgsfield game deploy … --json`; save `game_id` to `game/design/deploy.json`; re-run the smoke path on the returned URL.
- [ ] Commit: `game: docs and first deploy`.

### Self-review (done while writing)

- Spec coverage: A2 → Tasks 1, 5, 11; A3 → 4, 6; A4 → 7, 8; A5 → 9, 10; A6 → 2, 3; A7 → 12; A9 → every task's test step + 11; A10 respected.
- Names used consistently: `runTrial`, `stepChassis`, `buildRobot`/`setJoint`, `simulate`, `train`, `evaluate`, `Policy`, `makeSets`, `trainClassifier`, `predict`, `loadState`/`saveState`.
