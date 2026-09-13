# BracketBot Robotics — the game

Static web app: plain ES modules, Three.js 0.184 (vendored) rendering the original BracketBot
URDF, three pure simulations, a DOM overlay. No build step, no server logic.

## Run

```sh
python3 game/serve.py                        # http://127.0.0.1:8000  (?dev=1 → fps overlay)
```

`serve.py` = static server + `POST /launch`, which starts the desktop pong game
(`.venv/bin/python -m bracket_pong.play`) when the player presses "Start the pong game".
Any static server works for everything else.

## Layout

| Path | What |
|---|---|
| `index.html`, `main.js` | page, boot, router, fixed-step loop |
| `serve.py` | local server + pong-game launcher |
| `logic.js` | platform stub (solo game) |
| `strings.js` | every player-visible string |
| `state.js`, `rng.js` | localStorage progress (`bb-game-v1`), seeded PRNG |
| `robot.js`, `scene.js` | URDF → Three.js tree (`buildRobot`, `setJoint`, `makeSpinner`), renderer/camera |
| `ui.js`, `audio.js`, `hub.js` | overlay kit, synthesised SFX, hub screen |
| `levels/pid.js`, `rl.js`, `vision.js` | the three missions; `levels/common.js` shared plumbing |
| `sim/pid.js` | 50 Hz PID over a calibrated 1-D chassis (same law/gains/disturbances as the lab) |
| `sim/rally.js` | 2-D serve, 15-action paddle, linear softmax policy, REINFORCE, 20-serve eval set |
| `sim/vision.js` | procedural photos, centre-crop features, 3→3 softmax classifier |
| `assets/robot/` | `robot.json` (baked from the URDF by `tools/bake_urdf.py`) + 50 Draco GLBs |
| `assets/*.png`, `design/assets.csv` | textures, badges, hub background + manifest |
| `vendor/three/` | pinned Three.js modules and the Draco decoder |
| `tests/*.test.mjs` | `node --test` unit tests (sims, FK vs Python, state) |
| `tests/browser.mjs` | Playwright full-flow check (three levels, reload, phone touch-only, fps) |

## Tests

```sh
node --test 'game/tests/*.test.mjs'                 # from the repo root
cd game && python3 -m http.server 8000 &            # then:
node game/tests/browser.mjs                         # ONLY=pid|rl|vision|phone|perf to run one
```

The browser check uses `web/node_modules/playwright` and Google Chrome
(`CHROME_PATH` to override). Screenshots land in `artifacts/game-qa/`.

## Regenerating data

```sh
.venv/bin/python game/tools/bake_urdf.py --urdf chopped_urdf_v2/chopped_urdf_v2/urdf/chopped_urdf_v2.urdf --out game/assets/robot/robot.json
node game/tools/procedural_assets.mjs               # fallback textures/badges (design/assets.csv)
```

## Package and deploy

```sh
cd game && zip -r ../artifacts/bracketbot-game.zip . -x '*.DS_Store' 'tests/*' 'tools/*' 'README.md'
```

The ZIP has `index.html`, `logic.js` and `assets/` at its root, all references relative, so it
serves from any static host or subpath. `design/deploy.json` records the Higgsfield deployment
once one exists (`higgsfield game deploy … --json`, then `--game-id` for updates).
