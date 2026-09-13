// Level 2 — See the Ball. A depth camera on BracketBot's head watches a serve. This module is the
// whole tracking pipeline, the same one a real robot runs: pinhole camera → colour threshold →
// centroid → depth lookup → deprojection → finite-difference velocity → ballistic forecast of where
// the ball will cross the paddle plane. Its output (x, y, vx, vy) is exactly the pong policy's input.
// Everything is deterministic given the seed. No DOM.
import { rng as makeRng } from '../rng.js'
import { G, NET_X, NET_H, TABLE_LEN, E_TABLE, F_TABLE, DT, makeServe } from './rally.js'

// Frame: x forward along the table (0 = paddle plane), y up from the table top, z sideways.
export const TABLE_H = 0.76
export const BALL_R = 0.02
export const BALL_HUE = 24                  // orange ball; shading moves the hue ±9
export const CAM = { W: 160, H: 120, fovDeg: 50, x: -0.45, y: 0.62, pitch: 0.2, fps: 30 }   // head camera: pitched 0.2 rad down
export const F = (CAM.H / 2) / Math.tan(CAM.fovDeg * Math.PI / 360)   // focal length in pixels
export const DEPTH_NOISE = 0.008            // 1 σ, metres — a small stereo depth camera
export const DECIDE_X = 1.0                 // the arm must be told where to go once the ball is this close (m)
export const GOOD_ERR = 0.05                // a forecast within 5 cm is a hit for the paddle (half-height 8 cm)
export const HUE_WIDTHS = [2, 6, 10, 16, 30]
export const GAPS = [1, 3, 6, 12]           // frames between the two positions used for velocity
const STEPS_PER_FRAME = Math.round(1 / (CAM.fps * DT))

// --- tiny colour helpers -------------------------------------------------------------------
function hsv2rgb(h, s, v) {
  h = ((h % 360) + 360) % 360
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}
export function rgb2hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d > 0) h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4)
  if (h < 0) h += 360
  return [h, max > 0 ? d / max : 0, max]
}
// deterministic 2-D hash noise (wood grain, net mesh)
function hash(i, j) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// --- camera geometry -----------------------------------------------------------------------
// Camera axes in world: forward (cp, −sp, 0), up (sp, cp, 0), right (0, 0, 1). Depth = distance along forward.
const cp = Math.cos(CAM.pitch), sp = Math.sin(CAM.pitch)
const LIGHT = (() => { const l = [-0.4, 0.8, 0.45], n = Math.hypot(...l); return l.map(v => v / n) })()

// Where a world point (x, y, z=0) lands in the picture (sub-pixel), and its depth.
export function project(x, y) {
  const rx = x - CAM.x, ry = y - CAM.y
  const Z = rx * cp - ry * sp, U = rx * sp + ry * cp
  return { u: CAM.W / 2 - 0.5, v: CAM.H / 2 - 0.5 - F * U / Z, Z }
}
// A pixel plus a depth is a point in the world. This is what makes the depth picture so useful.
export function deproject(u, v, Z) {
  const a = (u + 0.5 - CAM.W / 2) / F, b = (CAM.H / 2 - v - 0.5) / F
  return { x: CAM.x + (cp + b * sp) * Z, y: CAM.y + (-sp + b * cp) * Z, z: a * Z }
}

// Render one frame by ray casting: the colour picture and the depth picture the camera would give.
export function renderFrame(ball, out = {}) {
  const { W, H } = CAM
  const rgb = out.rgb ?? new Uint8ClampedArray(W * H * 4), depth = out.depth ?? new Float32Array(W * H)
  const ocx = CAM.x - ball.x, ocy = CAM.y - ball.y
  const C = ocx * ocx + ocy * ocy - BALL_R * BALL_R
  for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) {
    const a = (u + 0.5 - W / 2) / F, b = (H / 2 - v - 0.5) / F
    const dx = cp + b * sp, dy = -sp + b * cp, dz = a
    let t = Infinity, kind = 0
    const A = dx * dx + dy * dy + dz * dz, B = dx * ocx + dy * ocy, disc = B * B - A * C
    if (disc > 0) { const ts = (-B - Math.sqrt(disc)) / A; if (ts > 0) { t = ts; kind = 1 } }
    if (dy < 0) { const tt = -CAM.y / dy; if (tt < t) { const px = CAM.x + dx * tt, pz = dz * tt; if (px >= 0 && px <= TABLE_LEN && Math.abs(pz) <= 0.7625) { t = tt; kind = 2 } } }
    if (dx > 0) { const tn = (NET_X - CAM.x) / dx; if (tn < t) { const py = CAM.y + dy * tn, pz = dz * tn; if (py >= 0 && py <= NET_H && Math.abs(pz) <= 0.8) { t = tn; kind = 3 } } }
    if (kind === 0 && dy < 0) { t = -(CAM.y + TABLE_H) / dy; kind = 4 }
    if (kind === 0) { t = dx > 0 ? (4.5 - CAM.x) / dx : 20; kind = 5 }
    let col
    if (kind === 1) {
      const px = CAM.x + dx * t, py = CAM.y + dy * t, pz = dz * t
      const nx = (px - ball.x) / BALL_R, ny = (py - ball.y) / BALL_R, nz = pz / BALL_R
      const lam = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2])
      col = hsv2rgb(BALL_HUE - 9 + 18 * lam, 0.92, 0.35 + 0.6 * lam)
    } else if (kind === 2) {
      const px = CAM.x + dx * t, pz = dz * t
      if (Math.abs(pz) < 0.012 || Math.abs(pz) > 0.745 || Math.abs(px - TABLE_LEN) < 0.02) col = [225, 225, 228]   // painted lines
      else {
        const grain = hash(Math.floor(px * 30), Math.floor(pz * 8)), tone = hash(Math.floor(px * 3), Math.floor(pz * 3))
        col = hsv2rgb(36 + 8 * grain, 0.55, 0.45 + 0.2 * tone)
      }
    } else if (kind === 3) { const m = hash(u, v) > 0.5 ? 0.82 : 0.62; col = [210 * m, 210 * m, 218 * m] }
    else if (kind === 4) col = [60, 62, 70]
    else col = [26 + v * 0.05, 32 + v * 0.05, 48 + v * 0.05]
    const i = v * W + u
    rgb[i * 4] = col[0]; rgb[i * 4 + 1] = col[1]; rgb[i * 4 + 2] = col[2]; rgb[i * 4 + 3] = 255
    depth[i] = t
  }
  return { rgb, depth }
}

// Colour threshold: keep pixels whose hue is within ±width of the ball's, saturated and not too dark.
// Returns the mask and the centroid of what survived — that is "the ball" as far as the robot knows.
export function detect(frame, width, out = {}) {
  const { W, H } = CAM
  const mask = out.mask ?? new Uint8Array(W * H)
  let n = 0, su = 0, sv = 0
  for (let i = 0; i < W * H; i++) {
    const [h, s, v] = rgb2hsv(frame.rgb[i * 4], frame.rgb[i * 4 + 1], frame.rgb[i * 4 + 2])
    const dh = Math.abs(((h - BALL_HUE + 540) % 360) - 180)
    const on = dh <= width && s >= 0.5 && v >= 0.3
    mask[i] = on ? 1 : 0
    if (on) { n++; su += i % W; sv += Math.floor(i / W) }
  }
  if (!n) return { mask, found: false, n: 0 }
  return { mask, found: true, n, u: su / n, v: sv / n, r: Math.sqrt(n / Math.PI) }
}

// --- ball flight (same physics as the rally) -------------------------------------------------
function stepBall(b) {
  const px = b.x, py = b.y
  b.vy -= G * DT; b.x += b.vx * DT; b.y += b.vy * DT
  if (b.y < 0 && b.x >= 0 && b.x <= TABLE_LEN) { b.y = -b.y * E_TABLE; b.vy = -b.vy * E_TABLE; b.vx *= F_TABLE; b.bounced = true }
  if (px > 0 && b.x <= 0) { b.crossY = py + (b.y - py) * px / (px - b.x); return true }
  return false
}

// The serve sampled at camera frame rate until it crosses the paddle plane.
export function flight(serve) {
  const b = { ...serve, bounced: false }
  const frames = [{ t: 0, x: b.x, y: b.y, vx: b.vx, vy: b.vy }]
  for (let k = 1; k < 200; k++) {
    for (let s = 0; s < STEPS_PER_FRAME; s++) {
      if (stepBall(b)) return { frames, crossY: b.crossY, crossT: (k - 1) / CAM.fps + (s + 1) * DT }
    }
    frames.push({ t: k / CAM.fps, x: b.x, y: b.y, vx: b.vx, vy: b.vy })
  }
  return { frames, crossY: null, crossT: null }
}

// Ballistic forecast from one measured state: where and when will the ball cross x = 0?
export function predictCross(x, y, vx, vy) {
  const b = { x, y, vx, vy }
  for (let i = 0; i < 2 * 240; i++) if (stepBall(b)) return { y: b.crossY, t: (i + 1) * DT }
  return null
}

// --- the tracker -----------------------------------------------------------------------------
function gauss(rng) { return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng()) }

// Track one serve. opts: { width (hue ±), mode 'depth' | 'size', gap (frames), bounceRule, keepFrames }.
// Every frame records what the camera saw, what the robot measured, and how wrong it was.
export function track(serve, { width = 6, mode = 'depth', gap = 3, bounceRule = true, keepFrames = false } = {}, rng = makeRng(5)) {
  const fl = flight(serve)
  const meas = []
  const scratch = keepFrames ? null : { rgb: new Uint8ClampedArray(CAM.W * CAM.H * 4), depth: new Float32Array(CAM.W * CAM.H), mask: new Uint8Array(CAM.W * CAM.H) }
  let decision = null
  fl.frames.forEach((fr, k) => {
    const frame = renderFrame(fr, scratch ?? {})
    const det = detect(frame, width, scratch ?? {})
    const truth = project(fr.x, fr.y)
    const m = { t: fr.t, truth: { x: fr.x, y: fr.y, vx: fr.vx, vy: fr.vy, u: truth.u, v: truth.v }, found: det.found, n: det.n }
    if (keepFrames) { m.rgb = frame.rgb; m.depth = frame.depth; m.mask = det.mask }
    if (det.found) {
      m.u = det.u; m.v = det.v; m.r = det.r
      m.pxErr = Math.hypot(det.u - truth.u, det.v - truth.v)
      const iu = Math.round(det.u), iv = Math.round(det.v)
      const Z = mode === 'depth' ? frame.depth[iv * CAM.W + iu] + DEPTH_NOISE * gauss(rng) : F * BALL_R / det.r
      const p = deproject(det.u, det.v, Z)
      m.Z = Z; m.x = p.x; m.y = p.y
      m.posErr = Math.hypot(p.x - fr.x, p.y - fr.y)
      // Bounce rule: if the ball went down and then up inside the window, the two photos are on
      // different sides of a bounce and their average speed means nothing — skip this frame.
      const win = meas.slice(Math.max(0, k - Math.max(gap, 2)), k).concat([{ found: true, y: p.y }]).filter(q => q.found)
      let wentDown = false, bounced = false
      for (let j = 1; j < win.length; j++) { if (win[j].y < win[j - 1].y) wentDown = true; else if (wentDown && win[j].y > win[j - 1].y) bounced = true }
      m.bounceInWindow = bounced
      const prev = meas[k - gap]
      if (prev?.found && !(bounceRule && bounced)) {
        // Two positions give the average speed over the gap — the speed at the gap's midpoint.
        // So the forecast starts from the midpoint too (else gravity makes every estimate lag).
        const dt = gap / CAM.fps
        m.vx = (p.x - prev.x) / dt; m.vy = (p.y - prev.y) / dt
        const mid = fl.frames[k - gap / 2] ?? fr   // truth at the midpoint, for the error only
        m.velErr = Math.hypot(m.vx - (gap % 2 ? fr.vx : mid.vx), m.vy - (gap % 2 ? fr.vy + G * dt / 2 : mid.vy))
        const pr = predictCross((p.x + prev.x) / 2, (p.y + prev.y) / 2, m.vx, m.vy)
        if (pr) { m.pred = pr.y; m.predErr = Math.abs(pr.y - fl.crossY) }
      }
      if (!decision && m.pred !== undefined && p.x < DECIDE_X) decision = { k, t: m.t, pred: m.pred, err: m.predErr, x: p.x, y: p.y, vx: m.vx, vy: m.vy }
    }
    meas.push(m)
  })
  const found = meas.filter(m => m.found), withVel = meas.filter(m => m.vx !== undefined)
  const mean = (arr, f) => arr.length ? arr.reduce((s, m) => s + f(m), 0) / arr.length : null
  return {
    frames: meas, crossY: fl.crossY, crossT: fl.crossT, decision,
    foundRate: found.length / meas.length,
    pxErr: mean(found, m => m.pxErr),
    posErr: mean(found, m => m.posErr),
    velErr: mean(withVel, m => m.velErr),
    predErr: decision?.err ?? null,
    hit: decision ? decision.err <= GOOD_ERR : false,
  }
}

// One serve per seed, always the same for a given n.
export function serveFor(n) { return makeServe(makeRng(3000 + n)) }
export function rngFor(n) { return makeRng(4000 + n) }

// The exam: n serves the player has not tuned on. Pass = the forecast was within GOOD_ERR on ≥ need of them.
export function exam(opts, { n = 10, need = 8, seed = 500 } = {}) {
  const results = []
  for (let i = 0; i < n; i++) results.push(track(serveFor(seed + i), opts, rngFor(seed + i)))
  const hits = results.filter(r => r.hit).length
  return { results, hits, n, need, pass: hits >= need }
}
