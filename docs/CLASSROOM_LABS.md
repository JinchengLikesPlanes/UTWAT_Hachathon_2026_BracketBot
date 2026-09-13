# BracketBot Learning Lab — teacher and physical activity guide

The browser lessons are designed for ages 10–13 with an adult guiding the room.
Each lesson takes about 15–20 minutes. The virtual experiments run locally and
do not command a physical robot.

## Before class

1. Install the project once with `uv sync --locked` and `cd web && npm install`.
2. Build the browser app with `cd web && npm run build`.
3. Start it from the project root with `.venv/bin/python -m bracket_pong.education`.
4. Open `http://127.0.0.1:8080` and run one experiment in each lab.

Students should work in pairs. Ask one student to predict and the other to run
the experiment, then switch roles. Treat surprising or unsuccessful training as
evidence to investigate rather than a wrong answer.

## Lab 1: Keep it steady (PID)

**Virtual objective:** hold the wheel-driven robot at its marked starting
position after a quick push, long push, or steady pull.

Ask students to run the quick push with all gains at zero, then increase P.
When they see overshoot or repeated corrections, introduce D as damping. Use the
steady pull to show why I remembers a small error. A successful challenge trial
stays within 5 cm of the target during its final two seconds. The challenge is
only complete when one set of gains passes all three disturbances; changing a
gain restarts the three-trial board.

## How lessons are marked complete

Each lesson ends with one short concept question. A lesson card shows COMPLETE
only after the final activity succeeds and the question is answered correctly.
Progress, slider settings, color labels and the small trained color model are
saved in the browser, so a reloaded page returns to the same step. A training
job that is still running when the page is reloaded is picked up again from the
server. Clearing the browser's site data resets a student's progress.

**Physical counterpart:** mark a target line on a clear, level floor. The robot
needs measured forward position, wheel speed control, a supervised stop control,
and manufacturer-approved speed/current limits. Use a repeatable low-force
disturbance instead of pushing the robot by hand. Start with wheels raised or a
test stand, validate command signs, then calibrate new gain limits on the actual
hardware. The numbers in the virtual lab are simulation gains and must not be
copied onto the robot.

## Lab 2: Teach a return (reinforcement learning)

**Virtual objective:** understand the five parts of training a model: set the
task, choose observations/actions, design rewards, train, and evaluate.

The lesson uses the fixed-base single-return environment. The robot observes arm
and ball state and controls six arm joints. Students compare a reward that favors
contact with one that favors a legal return. A short classroom run continues an
early PPO checkpoint for 10,240 steps. It may improve, remain flat, or regress;
students should use the 20-shot evaluation rather than training reward alone.

**Physical counterpart:** use a fixed robot base, an enclosed paddle workspace,
a repeatable ball launcher, ball tracking, and a way to detect paddle contact and
the first table landing. Map every simulated observation to a physical sensor or
estimator. Validate joint directions, limits, speeds, torque, latency, collision
stops, and emergency stop before any learned action is enabled. A simulation
checkpoint is not a hardware-ready controller.

## Lab 3: Teach it colors (visual machine learning)

**Virtual objective:** label red, blue, and yellow examples, train a small linear
classifier, and test it on different colors and lighting.

Students should notice that training fit and test behavior answer different
questions. After the first test, they add six dimmer or paler examples and train
again. The final color picker lets them explore ambiguous colors. Prediction
scores show what this three-class model prefers; they are not guarantees, and
the model has no “unknown” class.

**Physical counterpart:** place one centered red, blue, or yellow card in front
of a webcam or robot camera. Capture examples under at least two lighting
conditions while keeping a separate test set. Crop the same central region used
during training. This activity ends at classification; connecting predictions to
motors requires a separately reviewed hardware behavior.

## Discussion prompts

- PID: What changed when correction became stronger? What did damping change?
- RL: Could a robot earn the reward without doing exactly what we intended?
- Vision: Why can a model fit its examples and still make a poor new prediction?
- Across labs: What information did the robot receive, and what could it control?

