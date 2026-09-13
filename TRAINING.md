# First training result — 2026-09-12

## Runs

Training used local macOS CPU, four MuJoCo environments, PPO with a 64×64 MLP,
seed 0, and the existing environment/reward without physics or reward changes.

1. `runs/ppo-first-100k`: 100,352 steps. One successful exploratory training
   episode; deterministic held-out evaluation still returned 0/100 shots.
2. `runs/ppo-continued-300k`: resumed that policy for another 300,032 steps.
   Total: 400,384 steps, excluding the earlier independent smoke run.
   The continuation includes saved CSV progress, checkpoints and evaluations.

Every 25,000 continuation steps, 50 validation episodes were evaluated in a
separate seeded environment. The best checkpoint is chosen by mean reward.
The selected checkpoint was saved at continuation step 175,000; later weights
are also available in `policy.zip`. Validation is used for selection, not the
final test set. The task configuration and dependency versions are in run.json.

## Final held-out evaluation

Deterministic policy, 500 episodes each, fresh seeds 20000–20499. No updates
were made from these final evaluations.

| Policy / feed spread | Returns | Return rate | Paddle contact rate |
| --- | ---: | ---: | ---: |
| Stationary / ±2.5 cm | 0/500 | 0% | 100% |
| Best PPO / ±2.5 cm | 498/500 | 99.6% | 100% |
| Best PPO / ±10 cm | 282/500 | 56.4% | 83.2% |

Raw files in `runs/ppo-continued-300k/`: `test-starter.json`, `test-wide.json`,
`test-zero.json`. The best policy is `best_model.zip`. A recorded rollout at
seed 10000 produced a successful return: `artifacts/trained-return.gif`.

These tests measure the post-bounce starter feed, with a fixed base and one arm.
The widened test changes vertical and lateral target spread only. It does not
introduce full serves, opponents, spin, vision or new robot dynamics. Training
has been tested for only one random seed. See README physical assumptions.

## Next training stage

Introduce a feed-spread curriculum while retaining an easy-shot validation set.
Track both narrow and wide return rates to catch forgetting. Then validate
cross-net incoming feeds, joint speed constraints, arm/table collisions and
faster contact response before increasing match realism. Repeat training with
additional seeds to assess reliability.

## Lift-enabled policy and challenge

`runs/ppo-lift-300k` initializes from the selected arm policy with an expanded
35-input / 7-action network. Existing arm weights are copied; new observation
weights and lift-output weights start at zero. The lift exploration standard
deviation starts at exp(-1.5). PPO then updates the entire policy for 300,032
steps. This is warm initialization with a fresh optimizer, not optimizer resume.

Training varies target offsets by ±6 cm and horizontal feed speed from 2.3 to
3.5 m/s. The best validation checkpoint returned 466/500 final held-out shots
(93.2%), with paddle contacts on all 500. Seeds: 40000–40499. Failures: 8 own-side,
12 net, 14 miss. Raw metrics: `runs/ppo-lift-300k/test-variable.json`.
No changes were made based on the final test results.

A live episode at seed 30000 commanded carriage displacement between 0 and
-0.0621 m, physically moving approximately 4.7 cm and successfully returning
the shot. The lift therefore participates in control; its benefit over an
equally trained arm-only policy has not been isolated in an ablation study.

Legacy checkpoint regression: 99/100 starter returns at seeds 20000–20099.
Seventeen automated tests pass. The native window self-test exercises aim,
speed, manual carriage movement, duplicate launch prevention, physical rollout,
score update and clean window shutdown. Screenshots: `artifacts/play-test/`.

Reproduce training:

```sh
.venv/bin/python -m bracket_pong.train --lift --warm-start runs/ppo-continued-300k/best_model.zip --spread 0.06 --speed-range 2.3 3.5 --steps 300000 --envs 4 --output runs/new-lift-run
```

## Reproduce evaluation

```sh
.venv/bin/python -m bracket_pong.evaluate --policy ppo --model runs/ppo-continued-300k/best_model.zip --episodes 500 --seed 20000
.venv/bin/python -m bracket_pong.evaluate --policy ppo --model runs/ppo-continued-300k/best_model.zip --episodes 500 --seed 20000 --spread 0.1
```
