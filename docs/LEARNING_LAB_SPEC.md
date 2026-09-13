# BracketBot introductory robotics lab

  ## 1. Product and technical foundation

  Build a local browser application containing exactly three learning modules:

  1. PID: adjust parameters to help BracketBot maintain a target position.
  2. Reinforcement learning: train a ping-pong model through five explicit stages.
  3. Visual machine learning: teach a model to recognize red, blue, and yellow objects.

  The audience is ages 10–13 with teacher guidance. Each module takes approximately 15–20
  minutes. Students use buttons, sliders, and visual examples; coding and equations are optional
  explanations.

  Every lesson follows instruction → experiment → visible result → short explanation. Keep the
  interface focused on the current task, with no additional story world, economy, multiplayer, or
  competitive leaderboard.

  Delivery and stack

  - React, TypeScript, and Vite for the browser interface.
  - Three.js for robot visualization; MuJoCo remains authoritative for robot physics.
  - FastAPI for the local Python service.
  - Existing Gymnasium and Stable-Baselines3 PPO for RL.
  - A small PyTorch classifier for the vision module.
  - Local JSON records for progress and experiments; no accounts or cloud services.
  - One active learner session and one training job per local server in v1.
  - One launcher starts the service and serves the built frontend on localhost.

  Preserve the existing desktop game and training commands. Reuse the robot assets, physics, and
  single-return environment; implement educational behavior separately so existing checkpoints
  retain their meaning.

  Real-world scope: provide physical experiment guides for all three modules. This release does
  not send commands to physical hardware or claim calibrated simulation-to-real transfer.

  ## 2. Learning modules

  ### Module A — PID: help BracketBot hold its position

  Learning outcome: students understand that a controller measures error and corrects motion, and
  that stronger correction can cause oscillation.

  Use a level-floor scene with a target marker and BracketBot facing forward. Arms remain parked.
  Control forward position through the wheels; “stability” means maintaining position, not
  balancing an unsupported two-wheel robot.

  Implement a dedicated PID simulation using the existing chassis geometry and wheel contacts.
  The PID produces a bounded forward-speed command; a fixed heading controller keeps the robot
  facing forward.

   Step                      Student interaction                Feedback
  ━━━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   1. See the error          Run with correction disabled;      Highlight target position,
                             apply a preset push                actual position, and their
                                                                difference
  ────────────────────────  ─────────────────────────────────  ──────────────────────────────────
   2. Adjust P               Change “Correction strength —      Show slow recovery or overshoot
                             P” and repeat the same
                             experiment
  ────────────────────────  ─────────────────────────────────  ──────────────────────────────────
   3. Adjust D               Unlock “Damping — D”               Show reduced oscillation
  ────────────────────────  ─────────────────────────────────  ──────────────────────────────────
   4. Adjust I               Apply a small persistent           Show remaining offset reducing
                             disturbance; unlock “Persistent
                             correction — I”
  ────────────────────────  ─────────────────────────────────  ──────────────────────────────────
   5. Test the controller    Run three predefined               Compare recovery, overshoot, and
                             disturbance trials                 final error

  Implementation requirements

  - Use error = target_position − measured_position.
  - Compute PID at a fixed 50 Hz; retain the existing 1 ms physics timestep.
  - Use derivative on measurement with filtering, output saturation, and integral anti-windup.
  - Reset controller history whenever an experiment resets.
  - Apply slider changes between trials so comparisons are reproducible.
  - Show a live position graph with target and actual position; expose individual PID
    contributions under “More detail.”

  - Store gains, disturbance preset, seed, and measured outcome for each trial.
  - Establish bounded slider ranges through a calibration sweep on this simulation. Commit the
    resulting ranges and example presets before building the lesson around them; do not present
    them as hardware gains.

  Completion criteria

  Run all three test disturbances, hold position within 5 cm for the final two seconds of each
  eight-second trial, and answer a short P/D/I matching question. Provide a suggested working
  preset after three unsuccessful attempts, while still requiring students to rerun and inspect
  the result.

  The calibration gate must establish that these criteria are achievable without actuator
  saturation dominating the demonstration.

  Physical guide

  Describe a marked floor position, position measurement, a supervised low-speed controller, and
  repeatable disturbances. List required sensing and manufacturer-approved operating limits.
  Explicitly require hardware gain calibration.

  ### Module B — RL: five stages of training a ping-pong model

  Learning outcome: students can describe the task, observations, actions, rewards, training, and
  evaluation.

  Use the existing fixed-base, six-arm-joint single-return task. Keep the lift and chassis fixed
  in this lesson. Explain that the robot starts in a prepared pose and receives an incoming ball
  after its nominal bounce.

  The five stages are training-workflow stages, not five opponent difficulty levels.

   Stage                                 Student task                 Actual application
                                                                      behavior
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   1. Set the task                       Identify a successful        Set the goal to paddle
                                         return from three            contact followed by
                                         illustrated outcomes         landing on the far table
                                                                      half
  ────────────────────────────────────  ───────────────────────────  ────────────────────────────
   2. Define observations and actions    Sort cards into “Robot       Highlight ball position/
                                         senses” and “Robot           velocity and arm state;
                                         controls”                    animate bounded arm
                                                                      actions
  ────────────────────────────────────  ───────────────────────────  ────────────────────────────
   3. Choose rewards                     Compare “touch the ball”     Show how identical
                                         with “return the ball”       outcomes receive different
                                         reward presets               rewards
  ────────────────────────────────────  ───────────────────────────  ────────────────────────────
   4. Train                              Choose a reward preset,      Run a real bounded PPO
                                         press Train, and inspect     job, showing attempts,
                                         progress                     reward, and checkpoint
                                                                      evaluations
  ────────────────────────────────────  ───────────────────────────  ────────────────────────────
   5. Evaluate                           Test the before/after        Show contacts and legal
                                         policies on unseen shots     returns out of 20, then
                                                                      explain the difference

  Keep the configuration accessible

  - Observation and action cards teach the actual interface; students do not construct arbitrary
    tensors.

  - Retain the existing 32-value observation and six-value action interface.
  - Offer two reward presets: contact-focused and legal-return-focused.
  - Report contact and legal-return metrics under both presets; reward alone never determines
    success.

  - Expose no optimizer, network-size, or PPO hyperparameter controls in the student interface.

  Training behavior

  - Add a lesson-specific reward configuration while preserving existing environment defaults.
  - Use PPO with the existing small network configuration.
  - A classroom run performs 10,240 additional steps with one environment, with progress events
    and cancellation.

  - Start classroom runs from a bundled, deliberately early checkpoint. Label the operation
    “Continue training.”

  - Provide a teacher option to start from scratch; do not promise that a short run will learn a
    successful return.

  - Prepare and bundle reference checkpoints and their real training records for comparison.
  - Clearly label reference demonstrations separately from the student’s live run.
  - If a live run fails or does not improve, preserve its results and allow reference comparison;
    never substitute a reference result silently.

  - Changing reward presets starts a new experiment from the same early checkpoint.
  - Separate training, checkpoint-selection validation, and lesson evaluation seeds.
  - Use paired evaluation shots for before/after comparisons. Describe repeated use as a
    classroom comparison set, not a fresh scientific holdout.

  Completion criteria

  Complete the five interactions, run or explicitly inspect a reference training experiment,
  evaluate a policy, and correctly distinguish training reward from legal-return performance.
  Lesson completion does not depend on stochastic training improving within a short session.

  Physical guide

  Explain the corresponding robot, paddle, repeatable ball feed, ball tracking, and contact/
  landing measurements. Distinguish simulation state observations from what physical sensors must
  estimate. Include a staged reproduction procedure; deploying a PPO checkpoint requires a
  separate calibrated hardware project.

  ### Module C — vision: teach three object colors

  Learning outcome: students understand examples, labels, training, and testing on different
  images.

  Use red, blue, and yellow objects against several backgrounds. This is image classification of
  one centered object, not detection or robotic sorting.

   Step                    Student interaction                 Result
  ━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   1. Label                Sort 18 starter images, six per     Build a labeled training set
                           class
  ──────────────────────  ──────────────────────────────────  ───────────────────────────────────
   2. Train                Press Train                         Fit a small classifier using
                                                               their labels
  ──────────────────────  ──────────────────────────────────  ───────────────────────────────────
   3. Test                 Reveal predictions on 12            Show correct predictions out of
                           separate images                     12 and per-class results
  ──────────────────────  ──────────────────────────────────  ───────────────────────────────────
   4. Improve              Add six examples with different     Retrain and compare on the same
                           lighting/backgrounds                disclosed classroom test set
  ──────────────────────  ──────────────────────────────────  ───────────────────────────────────
   5. Try a real object    Use a webcam or upload an image     Classify the centered crop and
                                                               show prediction scores

  Implementation requirements

  - Use fixed color features from the center crop, followed by a trainable three-class linear
    softmax classifier in PyTorch.

  - Do not implement classification as hand-coded red/blue/yellow thresholds.
  - Use deterministic training with fixed initialization and a small fixed epoch budget.
  - Bundle images locally, including deliberately challenging lighting and background examples.
  - Keep training and test source images separate; avoid near-duplicate frames across splits.
  - Teach that prediction scores are not guarantees.
  - Require at least two labeled examples per class before training; the guided path supplies
    six.

  - Webcam use is optional. Uploaded images and bundled examples complete the same learning
    objectives.

  - Keep image processing local and camera captures in memory unless explicitly saved.
  - Provide a centered-object guide and explain that the classifier has only learned three
    classes; do not claim it can reliably reject every unfamiliar object.

  Completion criteria

  Label examples, train, inspect test results, add examples, retrain, and answer why testing on
  different images matters. Do not require perfect accuracy.

  Physical guide

  Repeat the activity with colored cards or blocks and a webcam or robot camera. No actuator
  integration is needed to reproduce the classification experiment.

  ## 3. Application architecture and interfaces

  Shared lesson interface

  Each screen contains:

  - A short instruction and stage indicator.
  - A simulation or image workspace.
  - Only the controls needed for the current step.
  - Run, Reset, and Compare actions where relevant.
  - A compact result explanation and optional technical details.

  Use visible text labels alongside colors, keyboard-accessible controls, and readable charts.
  Target laptop screens at 1280×720 and above; smaller screens remain usable through stacking.

  Simulation and visualization

  - Python owns simulation state and experiment timing.
  - Send named body transforms, ball/paddle state, and lesson metrics to the browser at up to 20
    Hz.

  - Three.js interpolates rendering between updates; it does not calculate contacts or scoring.
  - Load the supplied robot meshes once, preserving names, transforms, and scale.
  - Validate coordinates by comparing known body poses against MuJoCo.
  - RL training runs without rendering; short policy demonstrations use a separate environment.

  Minimum service interfaces

   Interface                           Responsibility
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   GET /api/lessons                    Lesson definitions and stages
  ──────────────────────────────────  ───────────────────────────────────────────────────────────
   POST /api/sessions                  Create or restore a local learner session
  ──────────────────────────────────  ───────────────────────────────────────────────────────────
   POST /api/sessions/{id}/commands    Start/reset experiments, apply bounded lesson settings,
                                       advance stages
  ──────────────────────────────────  ───────────────────────────────────────────────────────────
   WS /api/sessions/{id}/events        State updates, measurements, progress, results, and
                                       errors
  ──────────────────────────────────  ───────────────────────────────────────────────────────────
   POST /api/jobs                      Start RL training/evaluation or vision training
  ──────────────────────────────────  ───────────────────────────────────────────────────────────
   GET /api/jobs/{id}                  Retrieve authoritative job status and results
  ──────────────────────────────────  ───────────────────────────────────────────────────────────
   POST /api/jobs/{id}/cancel          Cancel an active job
  ──────────────────────────────────  ───────────────────────────────────────────────────────────
   POST /api/vision/predict            Classify an uploaded or webcam crop

  Use shared typed definitions for lesson progress, experiment configuration, metrics, and job
  state. Job states are queued, running, completed, cancelled, and failed.

  Execution and persistence

  - Run model training in a worker process so the UI and API remain responsive.
  - Allow only one training job at a time; explain when the slot is occupied.
  - Store experiments in unique directories with configuration, seed, task version, checkpoint
    lineage, and metrics.

  - Register bundled RL checkpoints with task compatibility and checksums.
  - Never overwrite existing training runs or silently load an incompatible policy.
  - Browser reload restores progress and reconnects to an active job.
  - Server restart marks interrupted jobs accordingly; restarting an experiment creates a new
    run.

  - Bind the service to localhost and serve frontend/API from the same origin.

  ## 4. Ordered implementation and acceptance gates

   Milestone               1. Verify the foundation
   Deliverable             Run existing tests; check available checkpoints; benchmark training
                           throughput; verify robot mesh loading
   Gate before continuing  Existing behavior understood, missing assets identified, reference
                           artifacts reproducible
  ───────────────────────────────────────────────────────────────────────────────────────────────
   Milestone               2. Build the application shell
   Deliverable             Local launcher, three module entries, lesson navigation, service
                           connection, progress persistence
   Gate before continuing  Open, navigate, reset, reload, and reconnect successfully
  ───────────────────────────────────────────────────────────────────────────────────────────────
   Milestone               3. Complete PID
   Deliverable             Dedicated environment, calibrated presets, sliders, graphs,
                           comparison, physical guide
   Gate before continuing  Automated trials demonstrate weak correction, overshoot, damping, and
                           persistent-error correction
  ───────────────────────────────────────────────────────────────────────────────────────────────
   Milestone               4. Complete RL
   Deliverable             Five-stage workflow, reward presets, worker jobs, reference policies,
                           evaluation
   Gate before continuing  A real training run completes or cancels correctly; results and
                           checkpoint provenance are accurate
  ───────────────────────────────────────────────────────────────────────────────────────────────
   Milestone               5. Complete vision
   Deliverable             Labeling, training, test comparison, upload/webcam, physical guide
   Gate before continuing  Changing labels affects the trained model; test images remain outside
                           training
  ───────────────────────────────────────────────────────────────────────────────────────────────
   Milestone               6. Classroom validation
   Deliverable             Full walkthrough, teacher instructions, packaging, student playtest
   Gate before continuing  All three lessons work from a clean installation without development
                           tools in the student flow

  Use game-development skills narrowly: gameplay guidance for interaction loops, UI guidance for
  lesson clarity, and QA guidance for browser verification. Inspect relevant awesome-gamedev-
  agent-skills instructions before implementation; avoid installing the entire collection or
  introducing generated assets when the supplied robot and simple teaching visuals suffice.

  Verification

  - Preserve and run the existing physics/environment test suite.
  - Test PID reset behavior, saturation, anti-windup, and reproducible disturbance responses.
  - Test that changing RL rewards changes reward accounting without changing physical outcome
    scoring.
    restoration.

  - Test vision training with changed labels, missing classes, invalid images, and denied camera
    access.

  - Exercise all three full lesson paths in a browser, including resets and reloads.
  - Verify rendered robot motion matches authoritative simulation state.
  - Check API responsiveness during training and record training duration on the target laptop.
  - Complete an offline-after-installation walkthrough using bundled assets.
  - Pilot with five representative students under adult guidance. Target at least four completing
    each module with no more than two navigation interventions and correctly answering its final
    concept question.

  ## 5. Explicit defaults and release boundaries

  - English language; guided ages 10–13.
  - Three modules only; no additional mission concepts.
  - PID stability means forward-position regulation on supported wheels.
  - RL teaches task → observations/actions → rewards → training → evaluation.
  - Short training may fail to improve; genuine results remain part of the lesson.
  - Vision recognizes three colors in a centered object crop.
  - Local browser delivery, local data, no hosted classroom infrastructure.
  - Physical reproduction guides are included; live robot integration is deferred.
  - Release requires working educational interactions and verified experiments, not a strong
    full-court ping-pong opponent.
