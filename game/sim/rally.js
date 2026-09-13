// Level 2 physics + learning: a 2-D ping-pong serve, a 15-action paddle, and a linear softmax
// policy trained with REINFORCE. Everything is deterministic given the seed.
//
// Frame: x forward along the table (0 = paddle plane at BracketBot's end, NET_X = net,
// TABLE_LEN = far end), y up from the table surface. One episode = one serve.
import { rng as makeRng } from '../rng.js'

export const G = 9.81
export const TABLE_LEN = 2.74
export const NET_X = 1.37
export const NET_H = 0.1525
export const PADDLE_HALF = 0.08          // contact if |ball y − paddle y| ≤ this at x = 0
export const E_TABLE = 0.8               // bounce restitution (vertical)
export const F_TABLE = 0.92              // horizontal speed kept per bounce
export const E_PADDLE = 0.8
export const PADDLE_SPEED = 1.2          // m/s, the arm's push along the paddle normal
export const DT = 1 / 240

export const HEIGHTS = [0.04, 0.10, 0.16, 0.22, 0.28]   // paddle centre above the table (m)
export const TILTS = [0, 0.3, 0.6]      // rad, paddle normal above +x: flat / medium / high loft
export const ACTIONS = []
for (const height of HEIGHTS) for (const tilt of TILTS) ACTIONS.push({ height, tilt })

export const SERVE = { x: 2.4, y: [0.2, 0.4], speed: [2.6, 4.2], angle: [0, 15] }   // angle in degrees

// Fly the ball until it crosses x = 0 (toward the robot) or dies. Returns the crossing state.
function flyToPaddle(b, path) {
  let bounces = 0, nearBounces = 0
  for (let i = 0; i < 2000; i++) {
    const px = b.x, py = b.y
    b.vy -= G * DT
    b.x += b.vx * DT
    b.y += b.vy * DT
    if (path) path.push({ x: b.x, y: b.y })
    // net
    if (px > NET_X && b.x <= NET_X) {
      const yAt = py + (b.y - py) * (px - NET_X) / (px - b.x)
      if (yAt < NET_H) return { dead: 'net' }
    }
    // table bounce
    if (b.y < 0 && b.x >= 0 && b.x <= TABLE_LEN) {
      b.y = -b.y * E_TABLE
      b.vy = -b.vy * E_TABLE
      b.vx *= F_TABLE
      bounces++
      if (b.x < NET_X) nearBounces++
      if (nearBounces > 1) return { dead: 'double-bounce' }
      continue
    }
    if (b.y < -0.5) return { dead: 'floor' }
    if (px > 0 && b.x <= 0) {
      const t = px / (px - b.x)
      const y = py + (b.y - py) * t
      return { y, vx: b.vx, vy: b.vy, nearBounces, bounces }
    }
  }
  return { dead: 'timeout' }
}

// Fly the returned ball: legal if it clears the net and lands on the far half.
function flyReturn(b, path) {
  for (let i = 0; i < 2000; i++) {
    const px = b.x, py = b.y
    b.vy -= G * DT
    b.x += b.vx * DT
    b.y += b.vy * DT
    if (path) path.push({ x: b.x, y: b.y })
    if (px < NET_X && b.x >= NET_X) {
      const yAt = py + (b.y - py) * (NET_X - px) / (b.x - px)
      if (yAt < NET_H) return { legal: false, why: 'net' }
    }
    if (b.y <= 0) {
      const landX = px + (b.x - px) * py / (py - b.y)
      const legal = landX >= NET_X && landX <= TABLE_LEN
      return { legal, why: legal ? 'in' : landX < NET_X ? 'short' : 'long', landX }
    }
    if (b.x > TABLE_LEN + 1.5 || b.x < -1) return { legal: false, why: 'out' }
  }
  return { legal: false, why: 'timeout' }
}

// A serve that is playable: crosses x = 0 after exactly one bounce on the robot's half.
export function makeServe(rng) {
  for (let tries = 0; tries < 200; tries++) {
    const y = rng.range(...SERVE.y), speed = rng.range(...SERVE.speed), ang = rng.range(...SERVE.angle) * Math.PI / 180
    const s = { x: SERVE.x, y, vx: -speed * Math.cos(ang), vy: speed * Math.sin(ang) }
    const c = flyToPaddle({ ...s })
    if (!c.dead && c.nearBounces === 1 && c.y > 0.02 && c.y < 0.55) return s
  }
  throw new Error('could not generate a playable serve')
}

export function simulate(serve, action) {
  const path = [{ x: serve.x, y: serve.y }]
  const b = { ...serve }
  const c = flyToPaddle(b, path)
  if (c.dead) return { contact: false, legal: false, why: c.dead, path, crossY: null }
  const contact = Math.abs(c.y - action.height) <= PADDLE_HALF
  if (!contact) {
    // let the ball fly on a little so the miss is visible
    for (let i = 0; i < 60; i++) { b.vy -= G * DT; b.x += b.vx * DT; b.y += b.vy * DT; path.push({ x: b.x, y: b.y }) }
    return { contact: false, legal: false, why: 'miss', path, crossY: c.y }
  }
  // paddle hit: reflect relative to a paddle moving along its normal
  const nx = Math.cos(action.tilt), ny = Math.sin(action.tilt)
  const ux = PADDLE_SPEED * nx, uy = PADDLE_SPEED * ny
  let rvx = c.vx - ux, rvy = c.vy - uy
  const dot = rvx * nx + rvy * ny
  rvx -= (1 + E_PADDLE) * dot * nx
  rvy -= (1 + E_PADDLE) * dot * ny
  b.x = 0; b.y = c.y; b.vx = rvx + ux; b.vy = rvy + uy
  const r = flyReturn(b, path)
  return { contact: true, legal: r.legal, why: r.why, path, crossY: c.y, landX: r.landX }
}

export const PRESETS = {
  contact: { contact: 8, success: 2, failure: 1 },
  return: { contact: 2, success: 10, failure: 2 },
}

export function rewardFor(outcome, presetId) {
  const p = PRESETS[presetId]
  return (outcome.contact ? p.contact : 0) + (outcome.legal ? p.success : -p.failure)
}

// Observation → features: bias + scaled ball state at serve time.
export function features(serve) {
  return [1, serve.x / TABLE_LEN, serve.y / 0.5, serve.vx / 5, serve.vy / 2]
}

export class Policy {
  constructor(seed = 0) {
    this.n = ACTIONS.length; this.k = 5
    this.w = new Float64Array(this.n * this.k)   // zero init: uniform policy
    this.seed = seed
    this.baseline = 0
    this.episodes = 0
  }
  probs(obs) {
    const f = features(obs)
    const z = new Array(this.n)
    let max = -Infinity
    for (let a = 0; a < this.n; a++) {
      let s = 0
      for (let j = 0; j < this.k; j++) s += this.w[a * this.k + j] * f[j]
      z[a] = s; if (s > max) max = s
    }
    let sum = 0
    for (let a = 0; a < this.n; a++) { z[a] = Math.exp(z[a] - max); sum += z[a] }
    for (let a = 0; a < this.n; a++) z[a] /= sum
    return z
  }
  act(obs, rng) {
    const p = this.probs(obs)
    let r = rng(), acc = 0
    for (let a = 0; a < this.n; a++) { acc += p[a]; if (r < acc) return a }
    return this.n - 1
  }
  greedy(obs) {
    const p = this.probs(obs)
    let best = 0
    for (let a = 1; a < this.n; a++) if (p[a] > p[best]) best = a
    return best
  }
  toJSON() { return { w: Array.from(this.w), baseline: this.baseline, episodes: this.episodes, seed: this.seed } }
  static fromJSON(j) { const p = new Policy(j.seed); p.w.set(j.w); p.baseline = j.baseline; p.episodes = j.episodes; return p }
}

export const LR = 0.05

// One REINFORCE episode: sample a serve, act, score, update. Returns the outcome (+ reward, action).
// explore = false always takes the current best guess — the honest way to show why exploration matters.
export function trainEpisode(policy, rng, presetId, lr = LR, explore = true) {
  const serve = makeServe(rng)
  const f = features(serve)
  const p = policy.probs(serve)
  const a = explore ? policy.act(serve, rng) : policy.greedy(serve)
  const outcome = simulate(serve, ACTIONS[a])
  const R = rewardFor(outcome, presetId)
  const adv = R - policy.baseline
  policy.baseline = policy.episodes === 0 ? R : 0.9 * policy.baseline + 0.1 * R
  policy.episodes++
  for (let b = 0; b < policy.n; b++) {
    const g = (b === a ? 1 : 0) - p[b]
    for (let j = 0; j < policy.k; j++) policy.w[b * policy.k + j] += lr * adv * g * f[j]
  }
  return { ...outcome, reward: R, action: a, serve }
}

export function train(policy, { episodes = 300, preset = 'return', seed = 1, explore = true, onEpisode } = {}) {
  const rng = makeRng(seed)
  const rewards = []
  let contacts = 0, legal = 0
  for (let i = 0; i < episodes; i++) {
    const o = trainEpisode(policy, rng, preset, LR, explore)
    rewards.push(o.reward)
    if (o.contact) contacts++
    if (o.legal) legal++
    onEpisode?.(i, o)
  }
  return { rewards, contacts, legal }
}

// Fixed comparison set: the same n serves for everyone, greedy actions.
export function evalSet(seed = 777, n = 20) {
  const rng = makeRng(seed)
  return Array.from({ length: n }, () => makeServe(rng))
}

export function evaluate(policy, seed = 777, n = 20) {
  const serves = evalSet(seed, n)
  const outcomes = serves.map(s => { const a = policy.greedy(s); return { ...simulate(s, ACTIONS[a]), action: a, serve: s } })
  return { contacts: outcomes.filter(o => o.contact).length, legal: outcomes.filter(o => o.legal).length, outcomes }
}

// Best possible action per serve (used by tests and the "what a perfect robot could do" note).
export function oracle(serve) {
  let best = -1, bestScore = -1
  ACTIONS.forEach((a, i) => { const o = simulate(serve, a); const s = (o.contact ? 1 : 0) + (o.legal ? 2 : 0); if (s > bestScore) { bestScore = s; best = i } })
  return best
}

// Fresh RNG for a training run; keyed by how many episodes the policy has seen so repeats differ.
export function rngFor(n) { return makeRng(1000 + n) }
