# Bracket Pong: robust rally game plan

## Product goal

Replace the shot launcher with a real table-tennis rally game. The player moves
a physical simulated paddle with the mouse. The same ball travels between the
player and BracketBot until one side misses or makes an illegal return. The
robot may reposition its chassis within a bounded area, move its carriage, and
move its right arm. A match has serves, rally scoring, game-over, and replay.

The player should win by timing and placing a difficult return, not by selecting
an unreachable point in a setup panel.

## Why the current policy fails at the edges

- The interactive aim pad exposes ±25 cm lateral and ±20 cm vertical offsets.
- The lift policy trained on only ±6 cm offsets and 2.3–3.5 m/s feeds.
- Its result is strong inside that distribution (466/500 held-out returns), but
  it has no reason to behave well in the outer UI cells.
- `ReturnEnv` ends after one robot return. It cannot learn recovery or rallies.
- The 35-value observation and seven actions cover arm and right lift only.
- `robot_mount` is fixed at `(-1.65, 0, 0)`. The supplied URDF contains wheel
  meshes, but the wheels are connected with fixed joints and lack usable drive,
  tire, balance, and mass parameters.

Randomly widening the existing `shot_spread` is insufficient. Many outer shots
would remain rare, the policy could forget central shots, and an average return
rate could conceal a completely dead corner.

## Interaction design

Remove the **Place your shot** panel and launch button from normal play.

### Human controls

- Use a fixed court camera during live play.
- Map mouse position to a human paddle on the far end line: horizontal mouse
  movement controls table width; vertical movement controls paddle height.
- Press/hold the left mouse button to drive the paddle forward through a short
  physical swing; release or 120 ms timeout retracts it. Timing matters.
- Use recent mouse motion to set paddle yaw/pitch within safe limits, allowing
  directional returns. Clamp paddle position, speed, acceleration, and angle so
  cursor teleporting cannot create impossible impulses.
- Space serves when the player owns the serve. Escape pauses to a compact menu.
- Keep camera orbit in replay/pause only, preventing camera gestures from
  competing with paddle control.

### Match flow

`PRE_SERVE -> SERVE -> RALLY -> POINT -> PRE_SERVE`, then `GAME_OVER`.

- First to 11, win by two; serve changes every two points and every point at
  deuce. Start with a simplified legal serve and label that ruleset in the UI.
- Track which side last hit and bounced the ball. A point ends on double bounce,
  net, out, missed end line, double hit, or illegal side landing.
- Show score, server, small speed indicator, and the last ruling. Use an optional
  trajectory/replay view after a point, never during the live rally.
- Add three robot levels by loading measured checkpoints, rather than scaling
  physics or secretly changing user shots.

## Chassis movement

### Game-first implementation

Add a simulated `base_y` slide joint to `robot_mount`, constrained to ±0.45 m
along the robot end line. Start with maximum speed 0.8 m/s and acceleration
2.0 m/s², then tune from visual and control tests. The policy commands desired
lateral velocity; a low-level controller applies the speed, acceleration, and
travel limits. Add base position/velocity and limit distance to observations.

This is an explicit lateral-drive abstraction. It makes the virtual game useful
without claiming the fixed wheel meshes constitute a calibrated mobile base.
The chassis should begin moving from ball-flight prediction, then let the arm
make the fast correction. Penalize energy, reversal, jerk, and end-stop contact.

### Robot-faithful wheel track (later)

If wheel realism matters, create a separate model with two hinge joints, a free
planar or balancing base, contactable tires, motor curves, correct inertias, and
a low-level balance/drive controller. Validate straight motion, turning, braking,
slip, and stability before attaching the rally policy. The apparent two-wheel
layout may require balance control and may not permit direct lateral movement.
Do not make this uncertain subsystem a prerequisite for the first playable game.

## Control architecture

Use two rates and two levels of control:

1. The learned policy runs every 10–20 ms and chooses a paddle target pose,
   carriage target, and chassis lateral velocity.
2. IK and bounded servo controllers convert the paddle target into six arm
   commands and enforce joint, lift, and chassis limits at the physics rate.

The higher-level paddle action makes training across the enlarged workspace more
stable than rediscovering six-joint coordination for every court cell. Retain a
raw-joint policy as a comparison, not as the only route.

Proposed policy state includes arm/lift/chassis position and velocity, paddle
pose and velocity, ball position/linear velocity/spin, predicted intercept and
landing estimates, time since contacts, last hitter, bounce count, and action
history. The robot never receives future human input or a hidden scripted shot.

## Training curriculum

### Stage 0: physics and reachability

- Add the human paddle, full-ball rally state, chassis joint, controller limits,
  and collision shapes for robot/table boundaries.
- Measure paddle reachability over `(base_y, lift, arm)` and generate a legal
  intercept mask. The UI and feed generators must respect physically valid ball
  trajectories, though difficult reachable shots remain allowed.
- Compare 1 ms and 0.5 ms physics for high-speed paddle and table impacts.

Gate: deterministic rallies follow the rules; no tunneling, double scoring,
cursor impulse exploit, or chassis/table penetration.

### Stage 1: positioning controller

Train or solve randomized paddle-pose tracking without a ball. Randomize targets
across the legal intercept mask. Mix central and edge targets in every batch.

Gate: at least 95% pose acquisition overall and 85% in every occupied grid cell,
within the speed/acceleration limits.

### Stage 2: full-envelope single returns

Train incoming trajectories using a stratified sampler over lateral position,
height, speed, approach angle, bounce point, and eventually spin. Sample by bin,
not a Gaussian centered on the paddle. Start with arm and lift, then unlock the
chassis when the predicted intercept falls outside the comfortable arm region.

Use a mixed batch throughout training:

- 30% central/easy shots to prevent forgetting.
- 50% uniform stratified shots over the current curriculum envelope.
- 20% failure replay from bins where recent evaluation is weakest.

Reward actual legal returns and eventual point outcomes. Before contact, use a
small paddle/intercept error term. After contact, use predicted landing error and
net clearance. Penalize collisions, saturation, chassis jerk, and excess energy.

Gate: ≥95% on the old center suite, ≥90% across the full playable envelope, and
≥75% in every sufficiently sampled cell. A chassis-disabled ablation must show
whether chassis travel improves edge coverage.

### Stage 3: rallies against varied opponents

Create a population of deterministic opponent controllers: consistent blocker,
wide placer, fast attacker, high lobber, and noisy novice. Each uses the same
physical human paddle interface. Train against a randomized opponent and landing
target, beginning with two-hit rallies and increasing the horizon.

Gate: median rally length ≥5 against the mixed opponent suite, with no opponent
style below a median of 3. Maintain the Stage 2 single-return gates.

### Stage 4: human-like play and self-play

- Record anonymized paddle trajectories and point outcomes from local playtests;
  use their distributions, not user identity, to tune synthetic opponents.
- Maintain a checkpoint population so self-play does not overfit to one policy.
- Randomize contact friction/restitution, controller delay, ball mass, table
  bounce, observation noise, and small timing offsets within validated ranges.
- Train three or more seeds and keep checkpoints based on the evaluation suite.

Gate: complete 20 playtest games without physics/rules failures. Report human
point rate by checkpoint and rally-length distribution; select difficulty levels
from those measurements.

## Evaluation dashboard

Replace one aggregate return rate with a coverage report:

- Success heatmaps over lateral × vertical intercept bins.
- Slices by speed, approach angle, bounce position, and spin.
- Worst-bin and 10th-percentile success alongside overall success.
- Miss breakdown: no contact, net, own side, long, wide, double bounce.
- Median/p90 rally length and point win rate per opponent style.
- Chassis travel, lift travel, joint saturation, energy, and collisions.
- Center-suite regression and chassis-enabled/disabled ablation.

Use fixed hidden seeds for final tests and separate seeds for checkpoint
selection. Save environment config, policy, random seed, training steps, and raw
per-episode results. A robustness claim requires at least three training seeds.

## Implementation slices

1. **Rally physics:** human paddle, swing control, contact ownership, bounce
   rules, continuous episodes, and tests.
2. **Bounded chassis:** `base_y`, low-level motion limits, collision clearance,
   observation/action update, and manual debug control.
3. **Playable shell:** replace aiming UI with mouse paddle, serve/rally score,
   pause/replay, and game-over flow.
4. **Workspace controller:** paddle-pose action and IK/servo layer, reach mask,
   scripted rally baseline.
5. **Robust return training:** stratified curriculum, failure replay, heatmap
   evaluation, checkpoint selection, and three seeds.
6. **Rally training:** opponent population, longer horizons, self-play, human
   playtests, and difficulty checkpoints.
7. **Optional real-wheel model:** separate validation track after drive and mass
   data are available.

## Definition of done for the next release

- A player controls a visible paddle and exchanges the same physical ball with
  the robot for multi-hit rallies.
- Match scoring works to 11 with deterministic, tested point rulings.
- The robot controls arm, right lift, and bounded lateral chassis motion.
- Outer reachable regions are intentionally represented in training and shown
  in evaluation heatmaps.
- Center performance does not regress below 95%; full-envelope return success is
  at least 90%, with the stated per-cell floor.
- Three training seeds meet the gates, and selectable difficulty checkpoints
  produce meaningfully different measured play.
- The UI contains no shot-placement panel in match mode.
