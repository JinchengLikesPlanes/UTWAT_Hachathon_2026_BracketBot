# Bracket Pong — Hackathon Notes

## The idea

Bracket Pong is a virtual table-tennis game built around the supplied BracketBot
robot model. A person controls a blue paddle with the mouse while the robot uses
its arm, lift, and wheels to return the same simulated ball.

The interesting reinforcement-learning problem is coordination: the robot must
predict where the ball will arrive, move its chassis, adjust its lift, position
and orient its arm, and produce a legal return before the ball escapes.

## What is implemented

- MuJoCo simulation using the original robot CAD/URDF assets.
- A free-moving chassis with two independently driven wheels.
- Wheel/ground contact produces translation and turning; there is no lateral
  slider in the current game.
- Six controlled arm joints and an actuated lift mechanism.
- One shared physical ball with paddle, table, net, floor, and robot contacts.
- Simplified table-tennis serving, bounce, fault, scoring, and replay rules.
- A mouse-controlled human paddle with adjustable physical swing power.
- A movable camera during play.
- PPO reinforcement learning layered over a ballistic prediction and inverse
  kinematics controller.
- Training from both isolated incoming feeds and real match serves.

## How to play

Run from the project folder:

```sh
.venv/bin/python -m bracket_pong.play
```

Controls:

- Move mouse: position the blue paddle.
- Left click: swing.
- `[` / `]`: decrease or increase swing power.
- Right-drag: orbit the camera.
- Scroll: zoom.
- `C`: reset the camera.
- `Space`: serve or begin the next point.
- `Esc` or `P`: pause.
- `R`: replay the previous point.
- `N`: start a new match.
- `Q`: quit.

The top-right label should say **Trained wheel RL**. Restart an old game window
if it still shows **Controller baseline**.

## Training notes

The first wheel-compatible controller was poor in real matches. It made a legal
return on only 10% of a 50-serve development benchmark. A policy trained only on
isolated feeds was also poor in live play, showing that feed performance did not
transfer automatically to legal serves and continued rallies.

Training was changed to mix real serves into rally episodes. Two longer PPO runs
were completed and fixed checkpoints were compared using actual serve returns
and rally length, rather than simply choosing the newest checkpoint.

The promoted policy is:

```text
runs/rally-wheels-match-candidate0/checkpoints/rl_model_150000_steps.zip
```

It is registered in `runs/wheels-default.json`, including a SHA-256 checksum so
the game detects missing or changed weights.

## Measured results

On a separate 100-serve holdout benchmark:

| Metric | Baseline controller | Selected RL policy |
| --- | ---: | ---: |
| At least one legal robot return | 16% | 67% |
| Robot point win | 12% | 44% |
| Mean paddle contacts | 1.03 | 1.51 |
| Median paddle contacts | 1 | 1 |

The selected model therefore plays substantially better than the original
wheel baseline, but it is not yet a strong or robust table-tennis opponent.

Swing power is physical rather than an artificial ball-speed boost. In a fixed
contact test, low, medium, and high power produced outgoing horizontal speeds of
approximately 3.5, 5.1, and 7.0 m/s.

Current verification: 36 automated tests pass, including wheel motion, turning,
chassis stability, ball momentum transfer, the mobile training environment,
default-policy integrity, and the opening-serve regression. The native game
window self-test also passes with the trained policy loaded.

## Honest limitations

- Wide and high/low incoming shots are still unreliable; some coverage cells
  have no successful returns.
- Median rallies remain short.
- The scripted benchmark is not a substitute for repeated human playtests.
- Wheel torque, tire friction, chassis mass, passive supports, and actuator
  settings are simulation estimates, not measurements from the real robot.
- The simplified serving and scoring rules are suitable for a hackathon game,
  but they are not a complete implementation of competition table-tennis rules.
- A policy that works in MuJoCo cannot be placed on the real robot safely without
  system identification, actuator limits, collision protection, latency tests,
  and a sim-to-real validation process.

## Best next steps

1. Collect human-play episodes and save the incoming-ball positions, return
   outcomes, and failure reasons.
2. Over-sample the weak outer court regions during training.
3. Add rewards for legal landing depth, recovery posture, and multi-hit rallies.
4. Train several seeds and select only with a held-out match benchmark.
5. Randomize motor strength, wheel traction, ball contact, sensing delay, and
   control latency for better robustness.
6. Calibrate the simulated drivetrain and arm against measurements from the
   physical robot before attempting sim-to-real transfer.

## Useful commands

Train a new match-oriented wheel policy:

```sh
.venv/bin/python -m bracket_pong.train_rally \
  --mobile --rallies --serve-fraction 0.85 \
  --output runs/my-match-policy --steps 300000 --seed 3
```

Evaluate real serve/rally behavior:

```sh
.venv/bin/python -m bracket_pong.evaluate_match \
  --model runs/my-match-policy/best_model.zip \
  --output artifacts/my-match-evaluation.json --episodes 100
```

Evaluate broad incoming-feed coverage:

```sh
.venv/bin/python -m bracket_pong.evaluate_rally \
  --mobile --model runs/my-match-policy/best_model.zip \
  --output artifacts/my-coverage.json --per-cell 20
```

## One-sentence pitch

We turned a supplied robot CAD model into a wheel-driven virtual table-tennis
opponent and trained a PPO residual policy that improved held-out legal serve
returns from 16% to 67%, while keeping the ball, paddle, lift, arm, and wheel
motion inside one continuous physics simulation.
