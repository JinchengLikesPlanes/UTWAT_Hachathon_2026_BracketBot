# Bracket Pong: project plan

## Objective

Train a neural policy to control the supplied BracketBot arm in a physical
table-tennis simulation, then let visitors challenge it with chosen shots.
The initial game is a return challenge, with rallies as a later milestone.
Development starts on macOS; the same CPU MuJoCo environment can run on the
RTX 2000 Ada machine. Benchmark before choosing the training host.

## Milestones and acceptance gates

1. **Physics foundation.** Preserve source URDF and meshes. Import link frames,
   joint axes and limits; attach a paddle; add table, net and free ball. Check
   forward kinematics, finite dynamics, contact response and timestep sensitivity.
   Capture a scene image. Document uncalibrated physical parameters.
2. **Environment.** Seeded Gymnasium reset/step, bounded actions, observation
   state, actual contact-based hits, first-return scoring, time limits, and tests
   against reward exploits. Begin with predictable feeds; support wider shots.
3. **Control baseline.** Find a useful ready pose and feasible hitting workspace.
   Implement a clearly labeled scripted interception controller. Require it to
   make legal returns before spending on long training. Measure return rate,
   contact rate, net failures and landing error on fixed held-out seeds.
4. **Learning.** PPO smoke run, then reach/hit/return curriculum. Save model,
   seed, environment configuration, dependency versions and evaluation metrics.
   Compare zero-action, random, scripted and learned policies on identical seeds.
   Advance only on held-out success, never reward alone. Repeat across 3 seeds.
5. **Challenge demo.** Shot controls, score, checkpoint comparison and replay.
   Use the same simulation and policy as evaluation; no decorative fake learning.
6. **Rallies and robustness.** Scripted opponent, recovery, serve rules, spin,
   stronger randomization, second arm and optional pixel observations.

## Initial design decisions

- MuJoCo for authoritative physics, Gymnasium for the task, SB3 PPO for learning.
- Fixed base, left arm and grippers. Right arm six revolute joints actuated;
  carriage fixed initially. Paddle rigidly attached to right_eef.
- First action interface: normalized joint target offsets around a ready pose,
  with force-limited position servos. End-effector/IK actions remain a baseline
  milestone decision after workspace measurements.
- State observations first; no vision model or physical robot transfer claim.
- 1 ms physics steps and 20 ms policy steps initially; validate fast contacts.
- Official-size table and ball dimensions; contact properties are tunable
  approximations, not a measured table-tennis material model.

## Asset audit / limitations

The source contains 54 links, 53 joints, 18 movable joints and 50 STL meshes.
Many source masses are implausibly small for hardware (e.g. an arm component
around 0.0007 kg). No collision tags are present. Preserve the original files;
use explicit surrogate link inertias and visual-only meshes in the first scene.
Only ball/table/net/floor/paddle contacts are initially enabled. Robot/table and
self-collision checks are required before calling the environment realistic.
Velocity/effort limits and actuator tuning need validation, not assumption.

## Progress (2026-09-12)

- Foundation and starter environment implemented; all 50 meshes load.
- Nine tests pass, covering all source link frames, bounce timestep sensitivity,
  seeded rollouts, contact credit, landing scoring, timeout and SB3 compatibility.
- Scene rendered and visually inspected: `artifacts/scene.png`.
- PPO smoke run completed: 2,048 steps, seed 0, two environments, CPU.
  Checkpoint: `runs/smoke-001/policy.zip`; metadata saved alongside it.
- Held-out seeds 10000–10099: stationary 100% hit / 0% return; random 88% hit /
  0% return; smoke PPO 100% hit / 0% return. No learned playing ability claimed.
- Initial 3 ms / 0.25 contact settings failed timestep sensitivity (rebound
  4.30 vs 1.78 m/s). Revised 6 ms / 0.3 settings yield 1.78 vs 1.58 m/s at
  1 ms / 0.5 ms timesteps for the test drop. Broader fast-impact validation,
  restitution calibration and robot collision constraints remain outstanding.
- Next: scripted interception/swing that clears the net and lands on the far
  half. Verify feasible returns before long PPO runs, then implement curriculum.

## Training update (2026-09-12)

At the user's request, started PPO on the existing task. A successful exploratory
return in the first 100k run established feasibility; continued for 300k more.
The selected learned policy returned 498/500 final held-out starter shots and
282/500 shots with four times the target spread. See TRAINING.md. This advances
the learning milestone without the originally planned scripted swing baseline;
stationary and random baselines remain available. No environment physics or
reward changes were needed for these runs. The next step is wider-shot
curriculum and more realistic constraints, not claiming full rally capability.

## Interactive challenge and lift update

Completed native mouse aiming, variable shot speed, scoreboard, pause/reset,
camera controls, and manual/automatic right-arm lift. Added lift-enabled task
configuration while preserving old checkpoint semantics. Trained the expanded
policy for 300,032 steps and evaluated 93.2% success on 500 unseen ±6 cm,
2.3–3.5 m/s feeds. UI and physics checks pass; launch with
`.venv/bin/python -m bracket_pong.play`. UI design follows PLAY_DESIGN.md.

## Next release plan

The next product target is continuous mouse-paddle rally play with a bounded
lateral chassis, full-envelope curriculum, and coverage-based evaluation. The
detailed implementation order, training gates, and chassis abstraction are in
`RALLY_ROBUSTNESS_PLAN.md`.

## References

- https://mujoco.readthedocs.io/en/stable/XMLreference.html
- https://mujoco.readthedocs.io/en/stable/python.html
- https://stable-baselines3.readthedocs.io/en/master/guide/custom_env.html
