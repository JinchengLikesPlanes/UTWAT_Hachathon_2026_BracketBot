// Level 1 physics: BracketBot as what it really is — a two-wheeled inverted pendulum.
//
// State: tilt θ (rad, + = leaning forward), tilt rate, wheel position x (m), wheel speed.
// The only actuator is wheel acceleration `a` (velocity-servoed motors with lag TAU, saturated).
//   θ'' = (g/L)·sin θ − (a/L)·cos θ − C_T·θ' + F·H/(M·L²)      (F = disturbance at height H)
//   x'' = a
// Controller (50 Hz, with DELAY_TICKS of sensing/actuation latency):
//   hold loop:     θ_ref = −clamp(kh·x + kv·x' + ki·∫x, ±TILT_REF_MAX)   (lean toward the line)
//   balance loop:  a_cmd = kp·(θ − θ_ref) + kd·θ'                      (chase the lean)
// Slider gains are "kid units" 0–10 and scaled by GAIN_SCALE. A fall (|θ| > FALL_RAD) freezes the run.
// Calibrated values recorded below; see tests/pid.test.mjs for the criteria they satisfy.

export const DT = 0.02
export const G = 9.81
export const L = 0.6            // centre-of-mass height above the axle (m)
export const M = 8              // mass above the axle (kg)
export const H = 1.0            // height where pushes are applied (m)
export const C_T = 0.3          // tilt damping (bearings, air)
export const TAU = 0.05         // motor velocity-servo lag (s)
export const A_MAX = 8          // wheel acceleration limit (m/s²)
export const DELAY_TICKS = 2    // 40 ms sensing + actuation latency
export const WHEEL_RADIUS = 0.0846
export const FALL_RAD = 1.4     // beyond this the mast is on the floor
export const TILT_REF_MAX = 0.08
export const INIT_TILT = 0.03   // every run starts with a tiny lean, like a real robot let go

export const GAIN_LIMITS = { kp: [0, 10], kd: [0, 10], kh: [0, 10], ki: [0, 10] }
export const GAIN_SCALE = { kp: 4, kd: 1, kh: 0.01, ki: 0.005 }
export const KV_PER_KH = 2       // hold-loop damping tied to its P
export const REFERENCE_GAINS = { kp: 6, kd: 5, kh: 5, ki: 5 }

export const DISTURBANCES = {
  push: { force: 20, start: 1.5, end: 1.58 },
  long_push: { force: 5, start: 1.5, end: 2.1 },
  steady_pull: { force: 0.8, start: 1.5, end: 8.0 },
  none: { force: 0, start: 0, end: 0 },
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

export function checkGains(g) {
  for (const k of Object.keys(GAIN_LIMITS)) {
    const [lo, hi] = GAIN_LIMITS[k]
    const v = g[k] ?? 0
    if (!(typeof v === 'number' && v >= lo && v <= hi)) throw new Error(`gain ${k} outside [${lo}, ${hi}]`)
  }
}

// One control tick of the body. state = { th, om, x, v, a, fallen }. aCmd in m/s², force in N.
export function stepBody(s, aCmd, force, dt = DT) {
  const n = 4, h = dt / n
  for (let i = 0; i < n; i++) {
    if (s.fallen) { s.v = 0; s.om = 0; continue }
    s.a += (clamp(aCmd, -A_MAX, A_MAX) - s.a) * (h / TAU)
    const al = (G / L) * Math.sin(s.th) - (s.a / L) * Math.cos(s.th) - C_T * s.om + force * H / (M * L * L)
    s.om += al * h
    s.th += s.om * h
    s.v += s.a * h
    s.x += s.v * h
    if (Math.abs(s.th) > FALL_RAD) { s.th = Math.sign(s.th) * FALL_RAD; s.fallen = true; s.om = 0; s.v = 0; s.a = 0 }
  }
  return s
}

export function makeController(gains) {
  checkGains(gains)
  const kp = (gains.kp ?? 0) * GAIN_SCALE.kp, kd = (gains.kd ?? 0) * GAIN_SCALE.kd
  const kh = (gains.kh ?? 0) * GAIN_SCALE.kh, kv = kh * KV_PER_KH, ki = (gains.ki ?? 0) * GAIN_SCALE.ki
  let ix = 0, prevTh = INIT_TILT, prevX = 0, dTh = 0, dX = 0
  return {
    step(th, x) {
      const rTh = (th - prevTh) / DT, rX = (x - prevX) / DT
      dTh = rTh                        // the IMU gyro measures tilt rate directly
      dX = 0.72 * dX + 0.28 * rX
      prevTh = th; prevX = x
      const proposed = clamp(ix + x * DT, -1, 1)
      const holdRaw = kh * x + kv * dX + ki * proposed
      const thRef = -clamp(holdRaw, -TILT_REF_MAX, TILT_REF_MAX)
      // anti-windup: only remember the error while close to the line and the lean request is not capped
      if (Math.abs(holdRaw) <= TILT_REF_MAX && Math.abs(x) < 0.3) ix = proposed
      const e = th - thRef
      const aCmd = kp * e + kd * dTh
      return { aCmd: clamp(aCmd, -A_MAX, A_MAX), thRef, p: kp * e, d: kd * dTh, hold: -thRef, i: -ki * ix }
    },
  }
}

export function runTrial(gains, disturbanceId, seconds = 8) {
  const spec = DISTURBANCES[disturbanceId]
  if (!spec) throw new Error(`unknown disturbance ${disturbanceId}`)
  const ctl = makeController(gains)
  const s = { th: INIT_TILT, om: 0, x: 0, v: 0, a: 0, fallen: false }
  const queue = new Array(DELAY_TICKS).fill(0)
  const trajectory = []
  const ticks = Math.round(seconds / DT)
  for (let k = 0; k < ticks; k++) {
    const t = k * DT
    const force = spec.start <= t && t < spec.end ? spec.force : 0
    const c = ctl.step(s.th, s.x)
    trajectory.push({ t: +t.toFixed(2), th: s.th, x: s.x, aCmd: c.aCmd, p: c.p, d: c.d, hold: c.hold, i: c.i, force, fallen: s.fallen })
    queue.push(c.aCmd)
    stepBody(s, queue.shift(), force)
  }
  const deg = r => Math.round(Math.abs(r) * 180 / Math.PI * 10) / 10
  const cm = v => Math.round(Math.abs(v) * 1000) / 10
  const after = trajectory.filter(p => p.t >= spec.end + 0.3)
  const tail = trajectory.filter(p => p.t >= seconds - 2)
  const fellAt = trajectory.find(p => p.fallen)?.t ?? null
  return {
    trajectory,
    metrics: {
      fallen: s.fallen,
      fellAt,
      maxTiltDeg: deg(Math.max(...trajectory.map(p => Math.abs(p.th)))),
      wobbleDeg: after.length ? deg(Math.max(...after.map(p => Math.abs(p.th)))) : 0,
      maxErrorCm: cm(Math.max(...trajectory.map(p => Math.abs(p.x)))),
      tailErrorCm: cm(Math.max(...tail.map(p => Math.abs(p.x)))),
      finalErrorCm: cm(trajectory[trajectory.length - 1].x),
      upright: !s.fallen,
      stable: !s.fallen && Math.max(...tail.map(p => Math.abs(p.x))) <= 0.15,
    },
  }
}
