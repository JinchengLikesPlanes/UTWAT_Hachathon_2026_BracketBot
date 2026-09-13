import test from 'node:test'
import assert from 'node:assert/strict'
import { rng } from '../rng.js'
import { makeServe, ACTIONS, simulate, PRESETS, rewardFor, Policy, train, evaluate, evalSet, oracle } from '../sim/rally.js'

test('simulate is deterministic and returns a path', () => {
  const s = makeServe(rng(3))
  const a = simulate(s, ACTIONS[7]), b = simulate(s, ACTIONS[7])
  assert.deepEqual(a, b)
  assert.ok(a.path.length > 20)
})

test('15 actions, two presets', () => {
  assert.equal(ACTIONS.length, 15)
  assert.deepEqual(Object.keys(PRESETS), ['contact', 'return'])
  assert.equal(rewardFor({ contact: true, legal: true }, 'return'), 12)
  assert.equal(rewardFor({ contact: false, legal: false }, 'contact'), -1)
  assert.equal(rewardFor({ contact: true, legal: false }, 'contact'), 7)
})

test('the task is solvable: an oracle returns most of the eval set', () => {
  const serves = evalSet()
  const legal = serves.filter(s => simulate(s, ACTIONS[oracle(s)]).legal).length
  assert.ok(legal >= 16, `oracle legal ${legal}/20`)
})

test('a fresh policy is bad at it', () => {
  const r = evaluate(new Policy(0))
  assert.ok(r.legal <= 6, `fresh legal ${r.legal}/20`)
})

test('300 episodes with the return preset improve legal returns (seeds 1-5)', () => {
  const fresh = evaluate(new Policy(0)).legal
  for (const seed of [1, 2, 3, 4, 5]) {
    const p = new Policy(0)
    train(p, { episodes: 300, preset: 'return', seed })
    const r = evaluate(p)
    assert.ok(r.legal - fresh >= 4, `seed ${seed}: legal ${r.legal} vs fresh ${fresh}`)
  }
})

test('the contact preset teaches touching', () => {
  const p = new Policy(0)
  train(p, { episodes: 300, preset: 'contact', seed: 1 })
  const r = evaluate(p)
  assert.ok(r.contacts >= 10, `contacts ${r.contacts}/20`)
})

test('without exploration the policy learns nothing', () => {
  const p = new Policy(0)
  train(p, { episodes: 300, preset: 'return', seed: 1, explore: false })
  assert.ok(evaluate(p).legal <= 6, 'greedy training should stay bad')
  const p2 = new Policy(0)
  train(p2, { episodes: 300, preset: 'return', seed: 1, explore: true })
  assert.ok(evaluate(p2).legal >= 10)
})

test('policy round-trips through JSON', () => {
  const p = new Policy(0); train(p, { episodes: 20, seed: 5 })
  const q = Policy.fromJSON(JSON.parse(JSON.stringify(p)))
  assert.deepEqual(evaluate(q), evaluate(p))
})
