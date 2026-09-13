import test from 'node:test'
import assert from 'node:assert/strict'
import { runTrial, DISTURBANCES, GAIN_LIMITS, REFERENCE_GAINS } from '../sim/pid.js'

const P = kp => ({ kp, ki: 0, kd: 0 })

test('reference gains are stable on every disturbance', () => {
  for (const id of Object.keys(DISTURBANCES)) {
    const { metrics } = runTrial(REFERENCE_GAINS, id)
    assert.ok(metrics.stable, `${id}: tail ${metrics.tailErrorCm} cm`)
  }
})

test('P only cannot cancel a steady pull', () => {
  const { metrics } = runTrial(P(1), 'steady_pull')
  assert.ok(metrics.tailErrorCm > 5 && !metrics.stable, `tail ${metrics.tailErrorCm}`)
})

test('high P alone rings visibly on a push', () => {
  const { metrics, trajectory } = runTrial(P(8), 'push')
  assert.ok(metrics.overshootCm >= 3, `overshoot ${metrics.overshootCm}`)
  let crossings = 0
  for (let i = 1; i < trajectory.length; i++) if (Math.sign(trajectory[i].x) !== Math.sign(trajectory[i - 1].x) && trajectory[i - 1].x !== 0) crossings++
  assert.ok(crossings >= 3, `crossings ${crossings}`)
})

test('adding D reduces overshoot', () => {
  const a = runTrial(P(8), 'push').metrics
  const b = runTrial({ kp: 8, ki: 0, kd: 2 }, 'push').metrics
  assert.ok(b.overshootCm < a.overshootCm, `${b.overshootCm} vs ${a.overshootCm}`)
})

test('I removes the steady offset', () => {
  const a = runTrial({ kp: 3, ki: 0, kd: 1 }, 'steady_pull').metrics
  const b = runTrial({ kp: 3, ki: 0.5, kd: 1 }, 'steady_pull').metrics
  assert.ok(!a.stable && a.tailErrorCm > 5, `no I: ${a.tailErrorCm}`)
  assert.ok(b.stable, `with I: ${b.tailErrorCm}`)
})

test('zero gains: the robot drifts away and stays away', () => {
  const { metrics } = runTrial(P(0), 'push')
  assert.ok(metrics.maxErrorCm > 10)
  assert.ok(!metrics.stable)
})

test('deterministic', () => {
  assert.deepEqual(runTrial(REFERENCE_GAINS, 'push'), runTrial(REFERENCE_GAINS, 'push'))
})

test('trajectory shape', () => {
  const { trajectory } = runTrial(REFERENCE_GAINS, 'push')
  assert.equal(trajectory.length, 400)
  for (const k of ['t', 'x', 'output', 'p', 'i', 'd', 'force']) assert.ok(k in trajectory[0], k)
})

test('gains outside limits throw', () => {
  assert.throws(() => runTrial({ kp: 9, ki: 0, kd: 0 }, 'push'))
  assert.throws(() => runTrial({ kp: 1, ki: -1, kd: 0 }, 'push'))
  assert.throws(() => runTrial({ kp: 1, ki: 0, kd: 5 }, 'push'))
  assert.throws(() => runTrial(P(1), 'nope'))
  assert.deepEqual(GAIN_LIMITS, { kp: [0, 8], ki: [0, 2], kd: [0, 4] })
})
