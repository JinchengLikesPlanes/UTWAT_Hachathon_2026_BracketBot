# BracketBot Robotics

**Direction:** a standalone browser game where kids complete small tasks with the real
BracketBot model to learn PID, RL and vision — see **[docs/GAME_PLAN.md](docs/GAME_PLAN.md)**
(design + implementation plan; the single source of direction). The founding intent is in
[note.md](note.md); real-world reproduction guides are in
[docs/CLASSROOM_LABS.md](docs/CLASSROOM_LABS.md).

The game lives in `game/` (in progress). Everything below is the existing code the game
builds on: the MuJoCo + Gymnasium + PPO training stack, the desktop rally match, and the
earlier local Learning Lab (spec in [docs/LEARNING_LAB_SPEC.md](docs/LEARNING_LAB_SPEC.md)).
The original asset bundle (URDF + Draco meshes) is in `chopped_urdf_v2/`.

## BracketBot Learning Lab

The local browser lab introduces robotics through three guided activities for
ages 10–13: PID position control, the five stages of training a ping-pong RL
model, and three-color visual classification.

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

## Play a rally match

The default window now lets you play with a mouse-controlled physical paddle,
against the robot's arm, lift and wheel-driven chassis controller:

```sh
.venv/bin/python -m bracket_pong.play
```

Move the mouse to position the blue paddle; click to swing. Use **[ / ]** to
decrease/increase swing power. Right-drag orbits the view during play, scroll
zooms, and C resets the camera. Camera dragging leaves the paddle in place.
Space serves or
starts the next point. Esc pauses, R replays the last point, N starts a new
match, and Q quits. Matches are first to 11, win by two. Keys 1–3 select
available checkpoints between points, not calibrated difficulty levels.
Add `--record-stats artifacts/my-playtest.json` to save local point outcomes
on exit, or `--model runs/my-wheels/best_model.zip` to select a wheels-v2 policy.
Without a compatible checkpoint the match uses the analytic baseline controller.
The supplied default is now **Trained wheel RL**, selected through
`runs/wheels-default.json`. It legally returned 67/100 held-out human serves
versus 16/100 for the baseline; this is not a full-court coverage result.
Restart an already-open window to load the new policy.

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
hardware transfer. See [TRAINING.md](TRAINING.md) for the evaluation record.

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
