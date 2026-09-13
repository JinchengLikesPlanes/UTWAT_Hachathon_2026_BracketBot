# Rally implementation and training status

## Implemented

### Trained wheel opponent: promoted checkpoint

The default game now loads `runs/wheels-default.json`, which selects the
150,000-step checkpoint of `rally-wheels-match-candidate0` by SHA-256.
The UI identifies it as **Trained wheel RL**. Restart existing windows to load it.

Diagnosis reproduced a default central serve landing on the robot's own half.
Isolated-feed training did not fix live play: the feed-trained policy returned
only 6% of development serves, versus 10% for the baseline. Training now supports
`--serve-fraction` to mix actual legal serves into continued-rally episodes.
Physical wheel/arm parameters, ball contacts and game rules were not changed
to obtain these improvements.

Completed runs: feed pretraining 50,176 steps; mixed-rally candidate 0 another
200,192 steps (75% real serves, warm-started from feed pretraining's best policy);
independent candidate 1 trained for 200,192 steps (85% real serves). All finished.
Eight fixed 50k/100k/150k/200k candidate snapshots, plus candidate 0's final
training-reward-best snapshot, were compared on 50 development serves, seed 81234.
Selection favored legal-return rate and then rally length, not point wins alone.
The selected snapshot scored 68% legal returns on that development set.

On a separate 100-serve holdout (seed 92345), evaluated only after selection:

| Metric | Baseline | Selected RL |
| --- | ---: | ---: |
| At least one legal robot return | 16% | 67% |
| Robot point win | 12% | 44% |
| Mean paddle hits | 1.03 | 1.51 |
| Median paddle hits | 1 | 1 |

Reports: [baseline](artifacts/wheels-match-holdout-baseline.json),
[selected policy](artifacts/wheels-match-holdout-selected.json).
These are human-serve episodes at lateral offsets ±0.25 m against five scripted
paddle styles, not human playtests. The broad 50-feed check remains weak:
24% legal returns versus 22% baseline, with zero-success cells. Long rallies,
wide coverage and hardware transfer are still not solved. One table collision
occurred in the selected policy's 100 holdout points.

A regression test reproduces the original default opening-serve failure and
requires a legal return from the default match. The promoted model handles the
central scripted sequence through four paddle hits and two legal robot returns.
Registry tests reject changed/missing selected weights. No automatic promotion
of untested future training checkpoints is enabled.

Final verification: 36 tests passed; native-window self-test passed and reported
`Trained wheel RL` (`artifacts/trained-wheels-ui/`).

### Wheels-v2 update

The default match now uses a six-degree-of-freedom chassis with two axle
hinges and independently force-limited wheel velocity servos. Ground contact
produces translation and turning; there is no lateral slide actuator. CAD
wheel/cap visuals rotate with their corresponding wheel. Tire radius is
0.0846 m and track width 0.32216 m, derived from the imported geometry.
Motor torque, mass, contact friction and low-friction spherical supports are
explicit simulation surrogates; this is not a hardware-calibrated digital twin.
The controller turns before driving to a bounded target and returns to a
forward-facing posture. Placement limits are controller targets, not hard rails.

Right-drag now orbits during live play, scroll zooms, and C resets the view.
Click completes a physical forward stroke even after releasing the button;
[ / ] adjusts the speed/acceleration of that stroke. No velocity impulse is
injected into the ball. A repeatable contact test gives approximately 3.5,
5.1 and 7.0 m/s outgoing horizontal speeds for power 0%, 50% and 100%.

The new 59-value observation rejects older slider checkpoints (46 values).
Train/evaluate with `--mobile`; play now uses the promoted policy above, with
an analytic fallback when no selected policy is configured. Existing slider runs and reports below are preserved
and describe **slider physics, not wheels-v2 performance**.

Verification: 33 automated tests pass, including wheel-driven turn/travel,
stability during that maneuver, power/contact transfer, and mobile Gym contract.
Native-window self-test passed live camera orbit/zoom/reset, power input,
point completion, replay and reset (`artifacts/wheels-v2-ui/`). Full-court
robustness and real-hardware transfer remain unverified.

### Prior slider implementation (preserved training task)

The default `python -m bracket_pong.play` is continuous rally play: a mouse
paddle, click-to-swing, shared MuJoCo ball contacts, simplified legal serves,
bounce/fault rules, alternating service, first-to-11/win-by-two scoring,
pause, point replay and optional local playtest records. The shot launcher
remains available with `--legacy`. Original robot assets are unchanged.

The robot has a lateral chassis slide limited to ±0.45 m, a commanded speed
limit of 0.8 m/s and acceleration ramp of 2 m/s², plus force-limited actuation.
The lift and arm participate in interception. Paddle input is rate-limited.
Conservative arm/chassis guards detect table contacts. These are simplified
collision proxies, not a complete collision model of the original meshes.

An analytic ballistic predictor and IK controller provide the baseline.
PPO learns eight residuals affecting interception, return direction/timing,
lift and chassis placement. The training environment uses central,
stratified full-envelope and failure-weighted feeds. Five scripted opponent
styles support continued rallies; optional contact randomization is available.
The completed runs below did not enable randomization.

## Completed training and held-out results

Checkpoints were selected by validation reward. The table below uses their
saved `best_model.zip`, not the final training snapshot. Each evaluation has
250 trials (10 per cell), seeds starting at 70000, lateral targets ±0.55 m,
heights 0.90–1.30 m and incoming speeds 2.6–4.0 m/s. Ten trials per cell are
only an initial estimate, not a precise confidence bound.

| Run | Actual additional steps | Metric | Result | Worst cell |
| --- | ---: | --- | ---: | ---: |
| rally-seed0 | 150,016 | One legal return | 41.6% | 0% |
| rally-seed1 | 300,032 | One legal return | 45.6% | 0% |
| rally-seed2 | 300,032 | One legal return | 44.8% | 0% |
| rally-long-seed0 | 100,352 | Point won against scripted opponent | 26.4% | 0% |

The long-rally run resumed seed0's best checkpoint. It is not a fourth
independent seed, and its win metric is not comparable to single-return rate.
Median paddle hits per episode was 1 in all four evaluations.

Raw episodes and visual reports:

- [Seed 0 coverage](artifacts/rally-seed0-coverage.html)
- [Seed 1 coverage](artifacts/rally-seed1-coverage.html)
- [Seed 2 coverage](artifacts/rally-seed2-coverage.html)
- [Long-rally point wins](artifacts/rally-long-coverage.html)

An earlier paired 100-shot check found 45% with chassis and 33% without it
(`artifacts/rally-initial-coverage.json`, `artifacts/rally-no-base.json`).
Its trial seeds differ from the 250-shot suite, so do not compare those
percentages directly. The default game retains seed0's validated checkpoint;
use `--model` to try another. Keyboard checkpoint choices are not calibrated
difficulty levels.

## Verification and limitations

30 automated tests pass: legacy kinematics/environment checks plus rally
bounce sequences, faults, deuce scoring, input/base bounds, physical paddle
contacts, table bounce sensitivity and the Gym environment contract. Native
UI self-tests exercise a scored point, replay and reset. An attempted
20-game deterministic bot smoke test exceeded its step budget; it is not a
passed full-match or human playtest. Win-by-two games can run indefinitely.

**The robustness plan's release gates are not met.** The positive-lateral
edge remains particularly weak, and sustained five-hit rallies are not
established. More identical PPO steps alone have not solved this. The next
control work should address dynamic reachability and IK posture selection,
then repeat the same held-out suite and chassis ablation. Training seeds
also need equal budgets before making controlled seed comparisons.

Remaining plan work includes a measured reachable envelope, stronger
long-rally curriculum, checkpoint/self-play opponent populations, broader
physical/observation randomization, calibrated difficulty levels and real
human playtests. No real-wheel traction or hardware transfer is implemented.
Masses and actuator/contact parameters remain surrogate simulation values;
ball spin aerodynamics are not modeled. Training feeds approximate a
post-bounce incoming flight; match serves use a separate simplified serve
reset. Nothing here establishes real-robot safety or performance.
