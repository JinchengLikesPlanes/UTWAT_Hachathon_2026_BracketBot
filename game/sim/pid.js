// Level 1 physics: a 1-D BracketBot chassis under a PID position hold.
//
// The PID law, gain limits, disturbances, trial length and the "stable" criterion are the
// same as the Learning Lab (bracket_pong/education/pid.py), which runs them in MuJoCo.
// The chassis here is a calibrated surrogate:
//   v' = (v_cmd − v) / TAU − DRAG·v + F / MASS,   x' = v
// plus a sensing/actuation latency of DELAY_TICKS control ticks (without it a P-only loop
// never rings, which hides the point of D).
// Calibrated values (Task 4): MASS = 20 kg, TAU = 0.15 s, DRAG = 0.5 s⁻¹, DELAY_TICKS = 4 (80 ms).
// With these: kp=8 alone rings +8 → −5 → +2 cm; kd=2 cuts the overshoot to ~3 cm; kd=4 limit-cycles;
// kp=3 alone leaves a 5.5 cm offset under the steady pull that ki=0.5 removes.

export const DT = 0.02             // 50 Hz control loop
export const WHEEL_RADIUS = 0.0846
export const MASS = 20
export const TAU = 0.15
export const DRAG = 0.5
export const DELAY_TICKS = 4   // sensing + motor latency, in control ticks

export const GAIN_LIMITS = { kp: [0, 8], ki: [0, 2], kd: [0, 4] }
export const REFERENCE_GAINS = { kp: 3.2, ki: 0.35, kd: 1.1 }

export const DISTURBANCES = {
  push: { force: 230, start: 0.65, end: 0.73 },
  long_push: { force: 70, start: 0.65, end: 1.25 },
  steady_pull: { force: 22, start: 0.65, end: 7.4 },
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

export function checkGains(g) {
  for (const k of ['kp', 'ki', 'kd']) {
    const [lo, hi] = GAIN_LIMITS[k]
    if (!(typeof g[k] === 'number' && g[k] >= lo && g[k] <= hi)) throw new Error(`gain ${k} outside [${lo}, ${hi}]`)
  }
}

// One control tick of the chassis. state = { x, v }; vCmd in m/s; force in N. Mutates state.
export function stepChassis(state, vCmd, force, dt = DT) {
  // Semi-implicit Euler at a sub-step so the 50 Hz command stays stable with a small TAU.
  const n = 4, h = dt / n
  for (let i = 0; i < n; i++) {
    const a = (vCmd - state.v) / TAU - DRAG * state.v + force / MASS
    state.v += a * h
    state.x += state.v * h
  }
  return state
}

export function makeController(gains) {
  checkGains(gains)
  let integral = 0, derivative = 0, previous = 0, wheel = 0
  return {
    // Returns the commanded chassis speed (m/s) for this tick and the P/I/D contributions.
    step(position, target) {
      const rate = (position - previous) / DT
      derivative = 0.72 * derivative + 0.28 * rate
      const error = target - position
      const proposed = clamp(integral + error * DT, -0.7, 0.7)
      const raw = gains.kp * error + gains.ki * proposed - gains.kd * derivative
      const command = clamp(raw, -0.65, 0.65)
      if (Math.abs(raw) <= 0.65 || Math.sign(error) !== Math.sign(raw)) integral = proposed
      previous = position
      const wheelTarget = command / WHEEL_RADIUS
      wheel += clamp(wheelTarget - wheel, -0.8, 0.8)
      return { vCmd: wheel * WHEEL_RADIUS, output: command, p: gains.kp * error, i: gains.ki * integral, d: -gains.kd * derivative }
    },
  }
}

export function runTrial(gains, disturbanceId, seconds = 8) {
  const spec = DISTURBANCES[disturbanceId]
  if (!spec) throw new Error(`unknown disturbance ${disturbanceId}`)
  const ctl = makeController(gains)
  const state = { x: 0, v: 0 }
  const queue = new Array(DELAY_TICKS).fill(0)
  const target = 0
  const trajectory = []
  const ticks = Math.round(seconds / DT)
  for (let k = 0; k < ticks; k++) {
    const t = k * DT
    const force = spec.start <= t && t < spec.end ? spec.force : 0
    const c = ctl.step(state.x, target)
    trajectory.push({ t: +t.toFixed(2), x: state.x, output: c.output, p: c.p, i: c.i, d: c.d, force })
    queue.push(c.vCmd)
    stepChassis(state, queue.shift(), force)
  }
  const abs = trajectory.map(p => Math.abs(p.x))
  const tail = trajectory.filter(p => p.t >= seconds - 2).map(p => Math.abs(p.x))
  let peakIdx = 0
  for (let k = 1; k < abs.length; k++) if (abs[k] > abs[peakIdx]) peakIdx = k
  const s = Math.sign(trajectory[peakIdx].x) || 1
  let overshoot = 0
  for (let k = peakIdx; k < trajectory.length; k++) overshoot = Math.max(overshoot, -s * trajectory[k].x)
  const cm = v => Math.round(v * 1000) / 10
  return {
    trajectory,
    metrics: {
      maxErrorCm: cm(Math.max(...abs)),
      finalErrorCm: cm(abs[abs.length - 1]),
      tailErrorCm: cm(Math.max(...tail)),
      overshootCm: cm(overshoot),
      stable: Math.max(...tail) <= 0.05,
    },
  }
}
