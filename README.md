# BracketBot Robotics

A browser game in which kids (10–13) teach the **real BracketBot model** (the original URDF
meshes) to play pong. One mission, three skills, in the order the real robot needs them:
stand up (PID), see the ball (depth-camera tracking), play pong (reinforcement learning).
Nothing is faked: the balancing loop, the ball tracker and the policy-gradient training all run
for real in the browser, and every mission ends with a "Try it on the real BracketBot" card.

Direction: **[docs/GAME_PLAN.md](docs/GAME_PLAN.md)** (design + implementation plan, the single
source of direction). Founding intent: [note.md](note.md). Physical activity guide:
[docs/CLASSROOM_LABS.md](docs/CLASSROOM_LABS.md).

## The story

The game is built around one question a kid can hold in their head: *what does a robot need
before it can hit a ball back?* The answer is the level order, and each level hands its result
to the next.

```
Level 1  Stand up      the balance loop keeps the two-wheeled robot upright and on its spot
   │
   ▼
Level 2  See the ball  the head camera turns colour + depth pictures into x, y, vx, vy
   │
   ▼
Level 3  Play pong     a policy reads those four numbers, learns by trial and error,
                       and the badge launches the real MuJoCo pong game
```

That chain is the real robot's pipeline, not a teaching metaphor. Level 1 is the loop the
physical BracketBot runs on its IMU and wheels. Level 2 is `bracket_pong/education/ball_tracker.py`
in the browser, and its four outputs are the observation `bracket_pong/rally.py` feeds its policy.
Level 3 trains on exactly those inputs. The hub draws the three as a numbered path; each finished
level earns a badge that says which skill it unlocked.

Two rules hold everywhere:

- **The robot never pretends.** Gravity really wins in Level 1 until the player adds P and D.
  The ball tracker really loses the ball when the colour window is too wide. The policy really
  fails to learn when exploration is off, and the level says so.
- **Every task is reproducible on the physical robot.** Each badge card gives the steps, the
  Python file that runs the same pipeline, and the safety line, from
  [docs/CLASSROOM_LABS.md](docs/CLASSROOM_LABS.md).

### Level 1: Stand up (PID)

BracketBot is what it is in real life, a two-wheeled inverted pendulum. The only actuator is
wheel acceleration, with motor lag and 40 ms of sensing latency. The player tunes four gains in
the order a real engineer would, and watches live tilt and position graphs.

| Step | The player | Passes when |
|---|---|---|
| 1 Watch it fall | Runs with the motors off; gravity wins in about 1.4 s | The trial ran |
| 2 Add P | Slides P up; the robot fights, swings harder, still falls | Any run with P > 0 |
| 3 Add D | Slides D up and survives a quick push | Upright for 8 s (it still drifts) |
| 4 Stay on the line | Slides Hold up, so the robot leans back toward its spot | Upright and within 15 cm for the last 2 s |
| 5 The exam | One set of gains against a push, a long push and a steady pull; I unlocks | All three stable with identical gains |
| Concept check | "It stands still 20 cm off the line under a steady lean. Which gain fixes that?" | I |

Sim: `game/sim/pid.js`, 50 Hz, calibrated so the reference gains (P 6, D 5, Hold 5, I 5) pass
and obvious mistakes fail the way they do on hardware.

### Level 2: See the ball (vision)

The camera cover on the robot's head (1.575 m up, measured from the URDF) is the sim's camera:
a 160×120 pinhole that ray-casts a colour picture and a depth picture 30 times a second. The
player builds the tracking pipeline one knob at a time and watches both pictures plus the
x, y, vx, vy readout.

| Step | The player | Passes when |
|---|---|---|
| 1 What the camera sees | Serves, watches colour and depth side by side | Answers "the depth picture tells distance" |
| 2 Find the ball | Picks a hue width (±2° … ±30°) | Ball found on ≥ 90 % of frames, ≤ 1 px off |
| 3 Where is it? | Guesses distance from apparent size vs. reading the depth pixel | Depth mode and ≤ 3 cm |
| 4 How fast, where will it land? | Picks the frame gap and the bounce rule; sees the forecast graph | Forecast within 5 cm, in time for the arm |
| 5 The exam | Ten unseen serves with the player's settings | ≥ 8 of 10 forecasts within 5 cm |
| Concept check | "A pixel at (80, 60). What else is needed to get metres?" | The depth at that pixel |

Sim: `game/sim/vision.js`. Between serves the robot idles: a ball dribbles on the far half and
the head (and its camera frustum) turns to follow it.

### Level 3: Play pong (RL)

The four numbers from Level 2 go into a 75-weight softmax policy over 15 paddle actions
(5 heights × 3 tilts, driving the real mast carriage and wrist in the 3-D scene). The seven
steps are the five stages of training an RL model, with two honest detours.

| Step | The player | What it teaches |
|---|---|---|
| 1 Set the task | Picks the replay where the job is actually done | Success must be defined before learning |
| 2 Senses and controls | Sorts cards into observation vs. action | The senses are Level 2's output |
| 3 Choose the reward | Compares two reward plans, picks one | Reward shapes behaviour |
| 4 Should it explore? | Chooses whether to try uncertain actions | With exploration off it learns nothing, and the level says so |
| 5 Train | 300 real REINFORCE episodes with a learning curve | Learning is a curve, not a switch |
| 6 Was 300 enough? | Reads the curve, can train 300 more | Stop when the held-out score stops climbing |
| 7 Evaluate | 20 serves it never trained on, before vs. after | Unseen serves prove skill, reward does not |
| Concept check | "Which number proves it returns balls?" | Legal returns on the 20 unseen serves |

The badge card ends with **Start the pong game**, which launches the desktop MuJoCo rally whose
policy was trained with PPO on the same five stages (see [How the RL works](#how-the-rl-works)).

### Look and feel

One warm paper-and-ink palette (`game/style.css`), Inter, hairline borders, a light grain over
the 3-D scene, and quiet copy. Charts use ink for the player's signal and green only for
"truth" lines. The hub is a winding path with numbered nodes, in mission order, with step dots
and badges. Textures and badges are procedural (`game/tools/procedural_assets.mjs`, manifest in
`game/design/assets.csv`); the ping-pong table is charcoal on a paper floor.

## Play the game

```sh
python3 game/serve.py
```

Open <http://127.0.0.1:8000> (add `?dev=1` for the fps overlay). `serve.py` is a plain static server plus
one endpoint that lets the "Play the real pong game" card start `bracket_pong.play` for you
(`cd game && python3 -m http.server 8000` works too, minus that button). Works with mouse, touch and
keyboard; progress is saved in the browser. See [game/README.md](game/README.md) for the
layout, tests and deployment.

```sh
node --test 'game/tests/*.test.mjs'   # sims, FK, state (no browser needed)
node game/tests/browser.mjs          # full flow in headless Chrome, server must be running
```

## How the RL works

There are two reinforcement-learning systems in this repo, and the game deliberately mirrors
one with the other: Level 3 trains a tiny policy in the browser with the simplest possible
policy gradient, and the "Play the real pong game" card at the end of that level launches the
MuJoCo rally whose policy was trained with PPO. Both follow the same five steps: set the task,
pick senses and controls, design a reward, train, evaluate on serves the robot never saw.

### In-browser game (Level 3 "Play Pong") — REINFORCE

Code: `game/sim/rally.js` (sim + learning), `game/levels/rl.js` (the seven on-screen steps),
spec in `docs/GAME_PLAN.md` § A4.

**Algorithm:** REINFORCE (vanilla policy gradient) with a running-mean baseline over a linear
softmax policy.

- **Environment.** 2-D ball (x along the table, y up), gravity 9.81 m/s², Euler-integrated at
  1/240 s, table restitution 0.8, paddle plane at `x = 0`, net at `x = 1.37`. One episode is
  one serve. Serves are seeded and randomised (`SERVE`), then rejected unless they are
  playable: cross the paddle plane after exactly one bounce on the robot's half (`makeServe`).
- **Observation → features.** `[1, x/2.74, y/0.5, vx/5, vy/2]`: a bias plus the ball's
  position and velocity at serve time (`features`).
- **Actions.** 15 discrete actions = 5 paddle heights × 3 tilts (`ACTIONS`). In the 3-D scene
  height drives the mast carriage `rj0` and tilt drives the wrist `rj5`.
- **Policy.** `π(a|s) = softmax(W · f(s))` with `W` a 15 × 5 matrix (75 weights), zero-initialised
  so the starting policy is uniform (`Policy`).
- **Reward presets** (`PRESETS`, the same numbers as the Learning Lab):
  `contact = {contact: +8, legal: +2, failure: −1}` and
  `return = {contact: +2, legal: +10, failure: −2}`.
- **Update** (`trainEpisode`), once per episode:
  1. sample a serve `s`, compute `p = π(·|s)`;
  2. sample `a ~ p` (or take the argmax when exploration is switched off);
  3. simulate the paddle contact and return flight → reward `R`;
  4. advantage `adv = R − baseline`, then `baseline ← 0.9·baseline + 0.1·R`;
  5. gradient of the log-softmax: `∂ log π(a|s) / ∂W[b] = (1[b = a] − p[b]) · f(s)`;
  6. `W[b] += lr · adv · (1[b = a] − p[b]) · f(s)` with `lr = 0.05`.

  Every episode is a single decision, so the return equals the immediate reward and this is
  exact REINFORCE, not an approximation. With exploration off the update still runs, but the
  sampled action is always the current argmax, so the policy never sees anything else and
  genuinely learns nothing; the level says so and offers a way back.
- **Evaluation** (`evaluate`). A fixed 20-serve "classroom comparison set" (seed 777), greedy
  actions, counted as contacts and legal returns before vs. after training. The concept check
  teaches that legal returns on unseen serves, not the reward, prove the robot returns balls.

The seven on-screen steps map onto that code as:

| Step | What runs |
|---|---|
| 1 Set the task | Replays three canned outcomes (miss / touch into net / legal return) |
| 2 Senses & controls | Card sort of observation vs. action |
| 3 Choose reward | Picks the `contact` or `return` preset; switching resets the `Policy` |
| 4 Should it explore? | Sets the `explore` flag passed to `trainEpisode` |
| 5 Train | `train()` runs 300 episodes in 20-episode chunks per animation frame; every 20 episodes `evaluate()` is recorded into a learning curve |
| 6 Was 300 enough? | "Train 300 more" extends the curve with a fresh RNG (`rngFor`) |
| 7 Evaluate | The 20 held-out serves, before vs. after, with the arm tweening to each chosen height/tilt |

### Real pong game (MuJoCo) — PPO

**Algorithm:** PPO (Stable-Baselines3 `MlpPolicy`, [64, 64] MLP, Gaussian actions), trained on
the real BracketBot model in MuJoCo. The rally version is a *residual* policy: it learns
corrections on top of an analytic intercept controller rather than raw joint targets.

There are two generations of environment.

**Single-shot return task** — `bracket_pong/env.py`, `bracket_pong/train.py`

- `ReturnEnv` loads the BracketBot arm from the original URDF. A ball is fed toward the paddle;
  the episode ends on a physics contact outcome (paddle, table, net, floor), never on proximity.
- Observation (32 floats, 35 with the lift): joint positions and velocities, ball position and
  velocity, paddle position and normal, last action, hit flag, normalised time.
- Action: 6 joint offsets (7 with `--lift`) around a damped-IK ready pose (`control.solve_pose`).
- Reward: `−0.001‖a‖² − 0.002‖a − a_prev‖²` smoothness cost, `+contact_reward` on the first
  paddle hit, `+success_reward` when the ball first lands on the far half, `−failure_penalty`
  for a miss, net or own-side landing.
- PPO: `n_steps = 256`, `batch_size = 64`, `lr = 3e-4`, 4 vectorised envs on CPU; checkpoints
  every 10k steps, 50-episode deterministic validation every 25k steps, `best_model.zip` kept.
- `bracket_pong/transfer.py` warm-starts the 7-action lift policy from a 6-action arm policy by
  zero-padding the first layer and the action head.
- `bracket_pong/education/rl.py` is the Learning Lab wrapper: the same environment and the same
  two reward presets as the browser game, resumed from a 10k-step early checkpoint so a
  classroom-sized job shows visible change.

**Full rally with chassis** — `bracket_pong/rally_env.py`, `bracket_pong/rally.py`,
`bracket_pong/train_rally.py` (this is behind the default checkpoint
`runs/rally-wheels-match-candidate0`)

- *Residual control* (`RallySim.robot_control`). A hand-written controller does the heavy
  lifting: a ballistic forecast of the intercept point with one bounce (`intercept`), the paddle
  normal needed to send the ball to a landing spot, base motion, then damped IK for the six arm
  joints. The 8-dimensional PPO action only nudges that: paddle target offset (`a[0:3]`), normal
  pitch (`a[3]`), landing y (`a[4]`), flight time (`a[5]`), lift (`a[6]`), base offset (`a[7]`).
  The policy head is initialised to zero with `log_std = −1.5`, so training starts exactly at
  the analytic baseline and PPO only has to learn corrections.
- Observation (`RallySim.observation`): arm joints, lift, base, ball position and velocity, paddle
  position and normal, the predicted intercept point and time, last-hitter flag, bounce and hit
  counts, last action, plus the chassis free-joint state when `--mobile`.
- Reward: `−0.002‖a‖²`, +1 per robot hit, +10 per legal return, −2 if the human wins the point.
- Curriculum: serves are drawn from a 5 × 5 grid over (y, z). 30 % go to the centre cell, 50 %
  cycle over all cells, 20 % are sampled in proportion to a per-cell failure average, so
  training keeps hammering the cells the robot is bad at. The scripted opponent style is
  randomised among five paddles; `--randomize` also perturbs friction and restitution.
- `--mobile` replaces the slide-joint base with a free-floating chassis on two real wheel
  hinges driven by a differential-drive controller (`rally_model.py`, `RallySim.drive_to`).
- PPO: `lr = 2e-4`, 2 envs, 300k steps, 50-episode validation every 12.5k steps; the source tree
  and its SHA-256 hashes are copied into the run directory for reproducibility.

End-to-end pipeline:

```
train_rally.py --mobile
  → RallyEnv (curriculum feeds) → RallySim (MuJoCo + analytic controller)
  → PPO residual policy → runs/<name>/best_model.zip
  → evaluate_rally.py (per-cell coverage on held-out serves: 67/100 legal vs 16 for the baseline)
  → play.py (mouse vs. robot, first to 11), launched from the game's "Start the pong game" button via game/serve.py
```

In one sentence: the browser game trains a 75-number brain with the simplest policy gradient
on a 2-D serve; the real game trains a 64 × 64 network with PPO in full 3-D physics, but only
to correct a physics-based controller — and both follow the same five steps.

## Also in this repo

Everything below is the earlier code the game builds on: the MuJoCo + Gymnasium + PPO
training stack, the desktop rally match, and the local Learning Lab (spec in
[docs/LEARNING_LAB_SPEC.md](docs/LEARNING_LAB_SPEC.md)). The original asset bundle (URDF +
Draco meshes) is in `chopped_urdf_v2/`.

## BracketBot Learning Lab

The local browser lab (`web/` + `bracket_pong/education/`) is the first version of the same
idea, before the pong story tied the levels together. It has three guided activities for ages
10–13 in its own order: PID position control on a 1-D chassis, the five stages of training a
ping-pong RL model (a real PPO job on the MuJoCo environment), and three-colour visual
classification. The game replaced the colour classifier with ball tracking so that Level 2
feeds Level 3; the lab keeps the classifier because it is the simplest possible "train, test,
improve" loop. The lab shares the game's paper-and-ink styling.

```sh
uv sync --locked
cd web && npm install && npm run build && cd ..
.venv/bin/python -m bracket_pong.education
```

Open <http://127.0.0.1:8080>. Experiments and model training stay on the local
computer. See [the classroom and physical activity guide](docs/CLASSROOM_LABS.md)
for teaching notes and the requirements for reproducing each activity safely on
real hardware.

With the server running, `cd web && npm run verify:visual` drives every lesson in
headless Chrome: PID challenge gate, all 18 vision labels through custom-color
prediction, a real 10,240-step RL job with stop/reload/resume, reload
persistence, concept checks, and a mobile layout check. Screenshots and
`report.json` land in `artifacts/learning-lab-qa/`. Student RL checkpoints are
written to `lesson_runs/` (git-ignored).

## Play a rally match (the real pong game)

A desktop window where you rally against the trained BracketBot in MuJoCo physics: mouse-driven
paddle for you, arm, lift and wheel-driven chassis for the robot. First to 11, win by two.

### 1. One-time setup

Needs Python 3.12 and [uv](https://docs.astral.sh/uv/). From the repo root:

```sh
uv sync --locked
```

This creates `.venv/` with MuJoCo, Gymnasium, Stable-Baselines3, PyTorch and GLFW. Nothing else
to download: the trained policy (`runs/rally-wheels-match-candidate0/…`) and the robot meshes
ship with the repo.

### 2. Start the game

Either of these works; both open the same window.

**From a terminal** (run with plain `python`, not `mjpython`, on macOS):

```sh
.venv/bin/python -m bracket_pong.play
```

**From the browser game:** run `python3 game/serve.py`, open <http://127.0.0.1:8000>, finish
Level 3 ("Play Pong") and press **Start the pong game** on the badge card. `serve.py` starts
the command above for you (`POST /launch`); a plain `python3 -m http.server` cannot, so the
button will tell you to use the terminal instead.

The window must be opened from a logged-in desktop session (it needs an OpenGL context).

### 3. Controls

| Input | Action |
|---|---|
| Mouse move | Position the blue paddle |
| Click | Swing |
| `[` / `]` | Decrease / increase swing power |
| Space | Serve, or start the next point |
| Right-drag / scroll / `C` | Orbit / zoom / reset the camera (the paddle stays put) |
| `1`–`3` | Switch between available checkpoints between points (not difficulty levels) |
| Esc / `R` / `N` / `Q` | Pause / replay last point / new match / quit |

### 4. Options

```sh
.venv/bin/python -m bracket_pong.play --model runs/my-wheels/best_model.zip     # use your own wheels-v2 policy
.venv/bin/python -m bracket_pong.play --record-stats artifacts/my-playtest.json  # save point outcomes on exit
```

Without `--model` the game loads the checkpoint named in `runs/wheels-default.json`
(**Trained wheel RL**, `rally-wheels-match-candidate0` at 150k steps). It legally returned 67/100
held-out human serves versus 16/100 for the analytic baseline; this is not a full-court coverage
result. If no compatible checkpoint is found the match falls back to the analytic baseline
controller. Restart an already-open window to load a new policy. How the policy was trained is
described in [How the RL works](#how-the-rl-works).

This is a working experimental game, **not yet a robust full-court opponent**.
The default match uses a free chassis, independent torque-limited wheel drives,
and tire/ground contact. It turns before driving sideways across the court;
it cannot command lateral sliding. Wheel dimensions follow the CAD assembly,
but mass, motors, traction and passive spherical supports are surrogate physics,
not calibrated real-hardware specifications. Target placement is limited to
±0.45 m laterally; unlike the old joint limit this is a controller workspace.
Old slider checkpoints are incompatible with the expanded chassis observation.
The policy learns eight residual corrections around an interception/IK
controller; it is not an end-to-end wheel-and-arm policy.

Train and evaluate the new task (use fresh output paths):

```sh
.venv/bin/python -m bracket_pong.train_rally --mobile --output runs/my-wheels --seed 3 --steps 300000
.venv/bin/python -m bracket_pong.evaluate_rally --mobile --model runs/my-wheels/best_model.zip --output artifacts/my-wheels-coverage.json --per-cell 20
.venv/bin/python -m bracket_pong.train_rally --mobile --output runs/my-long-wheels --resume runs/my-wheels/best_model.zip --rallies --steps 300000
```

For live-play training, include real serves rather than training only on
post-bounce feeds:

```sh
.venv/bin/python -m bracket_pong.train_rally --mobile --rallies --serve-fraction 0.85 --output runs/my-match-policy --steps 300000
.venv/bin/python -m bracket_pong.evaluate_match --model runs/my-match-policy/best_model.zip --output artifacts/my-match-evaluation.json
```

This benchmark starts with legal human serves and plays out the same physical
ball against five scripted paddle styles. It reports legal-return rate, robot
point wins and rally length; feed coverage alone does not establish play quality.

Evaluation uses a fixed wider benchmark, not the old narrow-shot settings.
Omitting `--mobile` retains the older slider task for reproducibility only.
JSON episode records and an HTML 5×5 coverage heatmap are saved together.
Use `--rallies` for point-win evaluation against scripted opponents;
without it, success means one legal robot return.

## Legacy shot challenge

The remaining sections describe the original fixed-base training task.

From this directory, open the interactive window:

```sh
.venv/bin/python -m bracket_pong.play --legacy
```

Use ordinary Python for this custom GLFW window, including on macOS. The older
passive viewer below still uses `mjpython`. The game automatically loads the new
lift-enabled policy, or falls back to the old arm policy with manual lift only.

| Control | Action |
| --- | --- |
| Drag in the aim pad / arrow keys | Set lateral and vertical shot offset |
| Speed slider / + and - | Set incoming horizontal speed, 1.5–5 m/s |
| Space / Launch shot button | Launch one shot |
| Lift button / L | Switch automatic or manual right-arm lift |
| Lift slider / U and J | Move the carriage up/down manually |
| P | Pause/resume the shot |
| R | Reset the scoreboard and prepare a new shot |
| Right mouse drag / scroll | Orbit camera / zoom |
| Escape / close window | Quit |

The robot scores for a successful return; you score if it misses, hits the net,
or returns onto its own side. Shot settings are locked while a ball is in flight.
This remains a launcher challenge, not a human paddle or full table-tennis match.
Start near the center at 2.8 m/s. The aim pad deliberately allows harder shots
outside the training distribution. Lowering the lift far enough puts the paddle
below the table; the full manual travel is for mechanism exploration.

The new policy controls the six arm joints **and the right-arm carriage**. It
trained for another 300,032 steps on ±6 cm target spread and 2.3–3.5 m/s feeds,
and returned 466/500 unseen shots (93.2%). Its automatic action covers the top
20 cm of carriage travel; manual mode exposes the full 1.03044 m. Left lift and
wheels remain fixed. The old 99.6% result below used easier feeds and is not a
direct comparison. Checkpoint: `runs/ppo-lift-300k/best_model.zip`.

To repeat the interactive control/screenshot check:

```sh
.venv/bin/python -m bracket_pong.play --legacy --self-test artifacts/play-test
```

## Current status

The original 50 visual meshes and URDF link transforms are imported. Six right-arm
joints use force-limited position actuators. A paddle is attached to `right_eef`;
the table, net, floor and ball use MuJoCo contacts. Seeded feeds, hit/return
scoring, PPO training, checkpoint loading, evaluation and native preview work.

A first PPO policy is now trained for the starter return challenge. After
400,384 total training steps, the best validation checkpoint returned **498/500
unseen starter shots (99.6%)**, versus 0/500 for a stationary paddle. With feed
spread widened from ±2.5 cm to ±10 cm, it returned 282/500 (56.4%). This is one
training seed in the simplified simulator, not evidence of full match play or
hardware transfer.

Watch the trained policy on macOS:

```sh
.venv/bin/mjpython -m bracket_pong.demo --model runs/ppo-continued-300k/best_model.zip
```

A recorded successful episode is available locally at
`artifacts/trained-return.gif`. Models and recordings are ignored by git and
must be copied separately if moving the demo to another machine.

## Setup

From this directory, with [uv](https://docs.astral.sh/uv/):

```sh
uv sync --locked
```

Python 3.12 is used for the initial installation. `uv.lock` records the resolved
dependencies. CPU training works on macOS and can also run on Linux/Windows;
the NVIDIA GPU is not required for this small initial policy.

## View

On macOS, the interactive viewer must use MuJoCo's Python launcher:

```sh
.venv/bin/mjpython -m bracket_pong.demo
```

On Linux use `.venv/bin/python`; on Windows use `.venv\Scripts\python.exe`.
Close the viewer window to stop. The default preview explicitly uses zero
actions and repeatedly launches balls; it is not a learned demonstration.

Save a still image without opening the interactive viewer:

```sh
.venv/bin/python -m bracket_pong.demo --snapshot artifacts/scene.png
```

Rendering requires an available graphics context. Headless training and tests
do not render.

## Validate, train, evaluate

```sh
.venv/bin/python -m pytest -q
.venv/bin/python -m bracket_pong.evaluate --policy zero --episodes 100
.venv/bin/python -m bracket_pong.evaluate --policy random --episodes 100
.venv/bin/python -m bracket_pong.train --steps 2048 --envs 2 --output runs/my-smoke
.venv/bin/python -m bracket_pong.evaluate --policy ppo --model runs/my-smoke/policy.zip --episodes 100
.venv/bin/mjpython -m bracket_pong.demo --model runs/my-smoke/policy.zip
```

Use a fresh output directory for each training run; existing runs are never
overwritten. Each run saves `run.json`, monitor CSVs, and `policy.zip`; longer
runs also save intermediate checkpoints. Evaluation loads the run's task
configuration. Default evaluation seeds start at 10,000, separate from default
training seeds. `--spread` can widen the feed distribution in training/evaluation.

Longer training is available with `--steps 1000000`, but first establish a
successful control baseline so training is not wasted on an impossible task.
PPO may round the requested steps up to a rollout boundary; the actual count
is recorded in `run.json`.

Continue a saved policy into a fresh run (steps are additional):

```sh
.venv/bin/python -m bracket_pong.train --steps 300000 --envs 4 --resume runs/ppo-first-100k/policy.zip --output runs/my-continuation
```

Training now records `progress.csv` and evaluates 50 episodes every 25,000 steps
using a separate validation environment seeded at 5,000. `best_model.zip` is
selected by validation reward; `policy.zip` is the final checkpoint. Always
check held-out return rate as well as reward. `evaluations.npz` stores validation
history. Use `--output path.json` on the evaluation command to save metrics.

## Task contract

- Observations (32 floats): six joint positions and velocities, ball position
  and linear velocity, paddle position and normal, previous action, hit flag,
  and elapsed fraction. Spin and aerodynamic effects are not modeled yet.
- Lift-enabled environments append carriage position, velocity and previous
  lift action (35 floats total); action seven commands carriage displacement.
- Actions (6 floats in [-1, 1]): target joint offsets, scaled by 0.5 radians
  around the IK ready pose and clamped to the source joint limits.
- Physics timestep: 1 ms; actions every 20 ms. Reset settles the arm before
  generating a feed, then advances only through the physics engine.
- Reward: +2 once for actual paddle contact; +10 for the subsequent first
  table contact on the far side; penalties for misses, own-side landings,
  net contact, action magnitude and abrupt action changes.
- Success: ball touched the paddle, then first touched the far table half.
  Touching the net ends the episode (a simplified return challenge rule).
- Starter feed begins on the near half, approximating the flight after a
  bounce. It is not yet an official serve or a full cross-net incoming shot.

## Physical assumptions

The source CAD inertias have suspiciously small masses and no collision shapes.
The importer therefore preserves geometry and kinematics while assigning
explicit surrogate inertia to moving links (0.3 kg, diagonal 0.002 kg m²),
and a 0.2 kg paddle/handle. These are not calibrated hardware parameters.
The base, other arm and fingers are fixed at zero joint displacement. Legacy
arm-only environments also fix the carriage. Lift-enabled environments use a
surrogate 0.5 kg carriage, 200 N force limit and position servo; these values
are simulation choices, not measured hardware specifications.
Robot meshes are visual-only: arm/table and self-collision are not yet checked.
Joint force is limited to ±10 Nm; actual velocity limits are not yet enforced.
Material contact parameters are an approximation and need broader calibration.

Tests cover all link frames against independent URDF forward kinematics,
table-bounce timestep sensitivity, deterministic episodes, contact-dependent
hit credit, landing-side scoring, timeouts and the SB3 environment contract.
Passing these checks does not establish sim-to-real accuracy or trained skill.
