import test from 'node:test'
import assert from 'node:assert/strict'
import { rng } from '../rng.js'

test('same seed same sequence', () => {
  const a = rng(5), b = rng(5)
  for (let i = 0; i < 20; i++) assert.equal(a(), b())
})

test('different seeds differ', () => {
  const a = rng(5), b = rng(6)
  assert.notEqual(a(), b())
})

test('range and int stay in bounds', () => {
  const r = rng(1)
  for (let i = 0; i < 1000; i++) {
    const v = r.range(2, 3)
    assert.ok(v >= 2 && v < 3)
    const n = r.int(4)
    assert.ok(n >= 0 && n < 4 && Number.isInteger(n))
  }
})
