import test from 'node:test'
import assert from 'node:assert/strict'
import { LABELS, makeSets, features, trainClassifier, predict } from '../sim/vision.js'

const labelled = (set, map = l => l) => set.map(s => ({ features: features(s), label: map(s.truth) }))
const score = (model, set) => set.filter(s => predict(model, features(s)).label === s.truth).length

test('sets are deterministic and balanced', () => {
  const a = makeSets(), b = makeSets()
  assert.deepEqual(a, b)
  assert.equal(a.train.length, 18); assert.equal(a.test.length, 12); assert.equal(a.improve.length, 6)
  for (const l of LABELS) {
    assert.equal(a.train.filter(s => s.truth === l).length, 6)
    assert.equal(a.test.filter(s => s.truth === l).length, 4)
    assert.equal(a.improve.filter(s => s.truth === l).length, 2)
  }
  for (const f of features(a.train[0])) assert.ok(f >= 0 && f <= 1)
})

test('correct labels → ≥ 10/12 on the unseen test set', () => {
  const { train, test: t } = makeSets()
  const m = trainClassifier(labelled(train))
  assert.ok(m.accuracy >= 0.9, `train acc ${m.accuracy}`)
  const s = score(m, t)
  assert.ok(s >= 10, `test ${s}/12`)
})

test('swapping red and blue labels flips predictions', () => {
  const { train, test: t } = makeSets()
  const swap = l => (l === 'red' ? 'blue' : l === 'blue' ? 'red' : l)
  const m = trainClassifier(labelled(train, swap))
  const reds = t.filter(s => s.truth === 'red')
  assert.ok(reds.every(s => predict(m, features(s)).label === 'blue'), 'reds should be called blue')
})

test('fewer than 2 examples of a class throws', () => {
  const { train } = makeSets()
  const few = labelled(train).filter((s, i) => s.label !== 'yellow' || i < 1)
  assert.throws(() => trainClassifier(few), /yellow/)
})

test('the improve set is hard, then learnable', () => {
  const { train, improve } = makeSets()
  const before = trainClassifier(labelled(train))
  const after = trainClassifier(labelled([...train, ...improve]))
  const sb = score(before, improve), sa = score(after, improve)
  assert.ok(sb <= 4, `before ${sb}/6 (should be hard)`)
  assert.ok(sa >= 5, `after ${sa}/6`)
})
