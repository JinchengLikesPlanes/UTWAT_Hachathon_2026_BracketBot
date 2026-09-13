import test from 'node:test'
import assert from 'node:assert/strict'
import { runTrial, DISTURBANCES, GAIN_LIMITS, REFERENCE_GAINS } from '../sim/pid.js'

const g = (kp = 0, kd = 0, kh = 0, ki = 0) => ({ kp, kd, kh, ki })
const R = REFERENCE_GAINS

test('no controller: the robot falls over within 3 s', () => {
  const { metrics } = runTrial(g(), 'none')
  assert.ok(metrics.fallen && metrics.fellAt < 3, JSON.stringify(metrics))
})

test('P alone fights but still falls — later than with no controller', () => {
  const none = runTrial(g(), 'push').metrics
  for (const kp of [3, 6, 10]) {
    const m = runTrial(g(kp), 'push').metrics
    assert.ok(m.fallen, `kp=${kp} should still fall`)
    assert.ok(m.fellAt > none.fellAt + 0.5, `kp=${kp} fell at ${m.fellAt} vs ${none.fellAt}`)
  }
})

test('P + D stands; more D means less wobble; it still drifts away', () => {
  assert.ok(runTrial(g(0, 5), 'push').metrics.fallen, 'D alone falls')
  const a = runTrial(g(6, 3), 'push').metrics, b = runTrial(g(6, 5), 'push').metrics
  assert.ok(a.upright && b.upright, JSON.stringify([a, b]))
  assert.ok(b.wobbleDeg < a.wobbleDeg, `${b.wobbleDeg} vs ${a.wobbleDeg}`)
  assert.ok(!b.stable && b.maxErrorCm > 15, `should drift: ${JSON.stringify(b)}`)
})

test('hold brings it back to the line after a push', () => {
  const a = runTrial(g(R.kp, R.kd), 'push').metrics, b = runTrial(g(R.kp, R.kd, R.kh), 'push').metrics
  assert.ok(!a.stable, 'no hold → not on the line')
  assert.ok(b.stable, `with hold: ${JSON.stringify(b)}`)
})

test('steady pull: hold alone leaves an offset, I removes it', () => {
  const a = runTrial(g(R.kp, R.kd, R.kh), 'steady_pull').metrics, b = runTrial(R, 'steady_pull').metrics
  assert.ok(a.upright && a.tailErrorCm > 15, `no I: ${JSON.stringify(a)}`)
  assert.ok(b.stable, `with I: ${JSON.stringify(b)}`)
})

test('reference gains pass all three exam disturbances', () => {
  for (const id of ['push', 'long_push', 'steady_pull']) {
    const { metrics } = runTrial(R, id)
    assert.ok(metrics.stable, `${id}: ${JSON.stringify(metrics)}`)
  }
})

test('deterministic, right shape, limits enforced', () => {
  assert.deepEqual(runTrial(R, 'push'), runTrial(R, 'push'))
  const { trajectory } = runTrial(R, 'push')
  assert.equal(trajectory.length, 400)
  for (const k of ['t', 'th', 'x', 'p', 'd', 'hold', 'i', 'force', 'fallen']) assert.ok(k in trajectory[0], k)
  assert.throws(() => runTrial(g(11), 'push'))
  assert.throws(() => runTrial(g(1, -1), 'push'))
  assert.throws(() => runTrial(g(1), 'nope'))
  assert.deepEqual(Object.keys(GAIN_LIMITS), ['kp', 'kd', 'kh', 'ki'])
  assert.ok('none' in DISTURBANCES)
})
