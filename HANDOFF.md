# BracketBot Learning Lab handoff

Last updated: 2026-09-12

## Goal and agreed product decisions

Build a local browser learning app for guided ages 10–13 with three introductory
robotics modules only:

1. PID tuning to hold BracketBot's wheel chassis at a target position.
2. Five stages of training a ping-pong RL model: task, observations/actions,
   rewards, training, and evaluation.
3. A simple visual machine-learning lesson that classifies red, blue, and yellow.

This release includes physical lab instructions but does not control real
hardware. The existing native Bracket Pong game and its CLI must remain working.

## Completed implementation

### Backend

- Added FastAPI/uvicorn dependencies and updated `uv.lock`.
- Added `bracket_pong.education.api`, served by
  `.venv/bin/python -m bracket_pong.education` on `127.0.0.1:8080`.
- Added lesson, local session, PID experiment, vision train/predict, RL training
  job, cancellation, job status, and reference-evaluation endpoints.
- Added `bracket_pong.education.pid`. It runs the real MuJoCo mobile chassis at
  a 1 ms physics step with PID control at 50 Hz, saturation, filtered derivative,
  and integral anti-windup.
- Calibrated three disturbances. With gains P=3.2, I=0.35, D=1.1, all three
  settle inside 5 cm. With gains disabled, the long push does not recover.
- Added `bracket_pong.education.vision`, a deterministic PyTorch linear softmax
  classifier trained from labeled RGB samples. This is learned rather than a
  hard-coded color threshold.
- Added `bracket_pong.education.rl`, which reuses the fixed-base 32-observation,
  six-action `ReturnEnv`, supports contact-focused and legal-return-focused
  reward presets, continues the local 10k checkpoint, saves unique lesson runs,
  and evaluates on 20 paired seeds.
- Extended `TaskConfig` with configurable contact/success/failure reward values.
  Defaults match the old behavior, so existing checkpoints and commands retain
  their task interface.

### Browser app

- Added `web/`: React, TypeScript, Vite, and Three.js.
- Added a responsive lab map and complete UI flows for PID, RL, and vision.
- PID includes gain sliders, three disturbances, animated robot displacement,
  measured results, and a position chart.
- RL includes goal selection, an observations/actions sorting exercise, two
  reward designs, a real background PPO job with progress/cancel, and reference
  evaluation.
- Vision includes 18 labeling controls, real classifier training, 12 test
  predictions, six robustness examples, and a custom-color prediction tool.
- Progress is saved in browser local storage.
- Added renderer diagnostics at `window.__THREE_GAME_DIAGNOSTICS__`.
- Production builds are served by FastAPI from `web/dist`.

### Documentation and QA

- Added `docs/CLASSROOM_LABS.md` with teacher guidance and honest requirements
  for reproducing each lesson on physical hardware.
- Added Learning Lab setup instructions to `README.md`.
- Added five education tests in `tests/test_education.py`.
- Added `web/scripts/verify-visual.mjs` and `npm run verify:visual`. It is now a
  12-step full-flow check: renderer diagnostics, PID challenge gate, all 18
  vision labels through train/test/improve/custom color, vision reload
  persistence, RL sorting/reward stages, UI cancellation, a real 10,240-step RL
  job resumed after a page reload, reference evaluation, all three concept
  checks, three COMPLETE cards, and a mobile horizontal-overflow check.
- Added `tests/test_education_api.py` (FastAPI `TestClient`, `httpx` added to
  dependencies) covering health/lessons, PID validation, vision train/predict
  round trip, and job listing/validation.
- Captured QA artifacts in `artifacts/learning-lab-qa/`.

### Session 2 additions (2026-09-12, evening)

- `GET /api/jobs` lists jobs newest first so a reloaded browser can resume the
  active training job. Only queued/running jobs are adopted; finished results
  live in browser storage.
- Browser persistence (`usePersistent`, local storage): PID gains and challenge
  board, RL reward preset plus student/reference evaluation summaries, vision
  labels plus the 3×3 trained color model and metrics. Trajectories and
  checkpoints are never stored in the browser.
- Completion gates: the PID challenge requires one gain set to pass all three
  disturbances (changing a gain resets the board); every lesson ends with a
  `ConceptCheck` question and only a correct answer marks the lesson COMPLETE.
- RL evaluate stage shows separate "Your model" and "Reference model"
  scoreboards instead of overwriting one board. The completed 10,240-step
  student run scored 17/20 contacts and 0/20 legal returns versus 20/20 and
  20/20 for the reference, which the copy now frames as expected.
- Feedback is no longer unmounted by auto-advancing: the RL sort result, the
  vision test callout, and the vision improve callout stay visible with an
  explicit NEXT button. The 12 test predictions render in their own test grid
  rather than being overlaid on the training samples.
- Vision stages 3–5 show a "no trained model loaded" tip with a GO TO TRAIN
  button when the model is missing.
- `RobotScene` is lazy-loaded: the app shell is 246 kB (77 kB gzip) and the
  Three.js chunk (519 kB, 131 kB gzip) loads only inside PID/RL.
- `lesson_runs/` added to `.gitignore`.

## Last verified state

- `.venv/bin/python -m pytest -q`: **47 passed**.
- `cd web && npm run build`: **passed**, no chunk warning (limit raised to 600 kB
  for the lazily loaded Three.js chunk).
- `cd web && npm run verify:visual` against the production server: **12/12
  steps passed**, no console/page errors. Resume-after-reload picked the job up
  at 2,048/10,240 steps; custom color `#2f5fd0` predicted BLUE · 94%.
- API lifecycle checked by hand: second job while one runs → 409; cancel →
  `cancelled` with no `lesson_runs` entry; full job → `completed` with
  `lesson_runs/<id>/policy.zip` and `run.json`. A 10,240-step job takes ~10 s on
  this machine plus a few seconds of 20-episode evaluation.
- Desktop canvas: 779×797 CSS/buffer pixels. Three.js PID scene: 15 calls,
  3,436 triangles, 15 geometries, 3 textures.
- The local server has been stopped.

## Important remaining work

1. The Three.js robot is an authored low-poly representation. The API mounts the
   supplied URDF/STL assets under `/robot-assets`, but the renderer does not yet
   import those meshes. If exact visual fidelity is needed, add URDF/STL loading
   and validate link transforms against MuJoCo.
2. The agreed plan mentioned WebSocket state events; the current implementation
   uses HTTP polling for jobs and returns PID trajectories as one response. This
   is sufficient for the current flows but is not the planned streaming API.
3. Vision's "try your own" step uses a browser color picker. Webcam or image
   upload is not implemented.
4. Local sessions exist in the API, but browser progress uses only local storage
   and does not call the session endpoints. Either wire the UI to sessions (for
   a teacher view across machines) or remove the unused endpoints.
5. Jobs are held in server memory; a server restart forgets a running job and
   the browser then shows READY again. `lesson_runs/<id>/run.json` survives, so
   a restart-safe job index could be rebuilt from disk if needed.
6. The RL "Train again" path reuses the same early 10k checkpoint each time
   rather than continuing the student's previous lesson checkpoint. Continuing
   from `lesson_runs/<previous>/policy.zip` would make repeated practice
   cumulative and is a natural next lesson beat.
7. The concept questions are single fixed questions. A small bank per lesson
   would reduce answer-sharing between pairs.
8. `verify:visual` depends on a running server and system Chrome; it is not
   wired into pytest or CI.

## Commands for the next agent

```sh
uv sync --locked
cd web && npm install && npm run build && cd ..
.venv/bin/python -m pytest -q
.venv/bin/python -m bracket_pong.education
```

Then open `http://127.0.0.1:8080`. In another terminal:

```sh
cd web
npm run verify:visual
```

The visual check defaults to system Chrome at
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`; override with
`CHROME_PATH` if necessary.

## Files added or materially changed

- `bracket_pong/education/` — API and three experiment implementations.
- `bracket_pong/env.py` — reward configuration with backward-compatible defaults.
- `web/` — browser application, dependencies, build, and visual QA script.
- `tests/test_education.py` and `tests/test_education_api.py` — education
  behavior and API tests.
- `docs/CLASSROOM_LABS.md` and `README.md` — setup and teaching guidance.
- `pyproject.toml` and `uv.lock` — web-service dependencies.

This directory is not currently a Git worktree, so there is no commit or diff to
hand off. Existing project files and model runs were preserved.
