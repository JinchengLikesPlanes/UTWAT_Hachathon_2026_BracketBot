import test from 'node:test'
import assert from 'node:assert/strict'
import * as V from '../sim/vision.js'

const serves = n => Array.from({ length: n }, (_, i) => V.serveFor(500 + i))
const runAll = (opts, n = 10) => serves(n).map((s, i) => V.track(s, opts, V.rngFor(500 + i)))
const mean = (rs, k) => rs.reduce((a, r) => a + (r[k] ?? 0), 0) / rs.length
const hits = rs => rs.filter(r => r.hit).length

test('camera model: project and deproject are inverses', () => {
  for (const [x, y] of [[2.4, 0.3], [1.0, 0.05], [0.4, 0.45]]) {
    const p = V.project(x, y)
    const w = V.deproject(p.u, p.v, p.Z)
    assert.ok(Math.abs(w.x - x) < 1e-9 && Math.abs(w.y - y) < 1e-9 && Math.abs(w.z) < 1e-9)
  }
})

test('frames are deterministic and the ball is where the camera model says', () => {
  const ball = { x: 1.2, y: 0.25 }
  const a = V.renderFrame(ball), b = V.renderFrame(ball)
  assert.deepEqual(a.rgb, b.rgb); assert.deepEqual(a.depth, b.depth)
  const det = V.detect(a, 8), truth = V.project(ball.x, ball.y)
  assert.ok(det.found && Math.hypot(det.u - truth.u, det.v - truth.v) < 1)
  assert.ok(Math.abs(a.depth[Math.round(det.v) * V.CAM.W + Math.round(det.u)] - truth.Z) < V.BALL_R)
})

test('colour width: too narrow loses the ball, too wide grabs the table', () => {
  const narrow = runAll({ width: 2 }), good = runAll({ width: 8 }), wide = runAll({ width: 30 })
  assert.ok(mean(narrow, 'foundRate') < 0.85, `narrow found ${mean(narrow, 'foundRate')}`)
  assert.ok(mean(good, 'foundRate') > 0.9 && mean(good, 'pxErr') < 0.6, `good found ${mean(good, 'foundRate')} px ${mean(good, 'pxErr')}`)
  assert.ok(mean(wide, 'pxErr') > 10, `wide px ${mean(wide, 'pxErr')}`)
})

test('depth beats guessing distance from the ball\'s size', () => {
  const depth = runAll({ width: 8, mode: 'depth' }), size = runAll({ width: 8, mode: 'size' })
  assert.ok(mean(depth, 'posErr') < 0.03, `depth ${mean(depth, 'posErr')}`)
  assert.ok(mean(size, 'posErr') > 0.15, `size ${mean(size, 'posErr')}`)
})

test('velocity gap: 1 frame is noisy, 12 frames span the bounce, 3 is best', () => {
  const g1 = runAll({ width: 8, gap: 1 }), g3 = runAll({ width: 8, gap: 3 }), g12 = runAll({ width: 8, gap: 12 })
  assert.ok(hits(g3) > hits(g1), `gap1 ${hits(g1)} gap3 ${hits(g3)}`)
  assert.ok(hits(g3) > hits(g12), `gap12 ${hits(g12)} gap3 ${hits(g3)}`)
  assert.ok(hits(g3) >= 8)
})

test('the bounce rule removes the forecast jump', () => {
  const on = runAll({ width: 8, gap: 3, bounceRule: true }), off = runAll({ width: 8, gap: 3, bounceRule: false })
  assert.ok(hits(on) >= hits(off) + 2, `on ${hits(on)} off ${hits(off)}`)
  assert.ok(mean(on, 'predErr') < mean(off, 'predErr'))
})

test('exam: good settings pass, a wide colour window fails, and it is reproducible', () => {
  const good = V.exam({ width: 8, mode: 'depth', gap: 3, bounceRule: true })
  assert.ok(good.pass && good.hits >= 8, `good ${good.hits}/${good.n}`)
  const bad = V.exam({ width: 30, mode: 'depth', gap: 3, bounceRule: true })
  assert.ok(!bad.pass, `bad ${bad.hits}`)
  assert.equal(V.exam({ width: 8, gap: 3 }).hits, good.hits)
})

test('the decision comes early enough for the arm and carries the policy\'s four inputs', () => {
  for (const r of runAll({ width: 8, gap: 3 })) {
    assert.ok(r.decision, 'no decision')
    assert.ok(r.crossT - r.decision.t > 0.15, `only ${r.crossT - r.decision.t} s before crossing`)
    for (const k of ['x', 'y', 'vx', 'vy']) assert.equal(typeof r.decision[k], 'number')
  }
})
