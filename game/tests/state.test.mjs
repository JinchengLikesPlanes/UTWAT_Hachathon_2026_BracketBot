import test from 'node:test'
import assert from 'node:assert/strict'

globalThis.localStorage = {
  store: {},
  getItem(k) { return this.store[k] ?? null },
  setItem(k, v) { this.store[k] = String(v) },
  removeItem(k) { delete this.store[k] },
}

const { loadState, saveState, resetState, defaultState, STORAGE_KEY } = await import('../state.js')

test('empty storage yields defaults', () => {
  localStorage.store = {}
  assert.deepEqual(loadState(), defaultState())
})

test('round trip', () => {
  localStorage.store = {}
  const s = defaultState()
  s.levels.pid.step = 3
  s.levels.pid.gains.kp = 2.5
  saveState(s)
  assert.deepEqual(loadState(), s)
})

test('corrupt json yields defaults', () => {
  localStorage.store = { [STORAGE_KEY]: '{not json' }
  assert.deepEqual(loadState(), defaultState())
})

test('other version yields defaults', () => {
  localStorage.store = { [STORAGE_KEY]: JSON.stringify({ version: 99, levels: {} }) }
  assert.deepEqual(loadState(), defaultState())
})

test('reset clears', () => {
  const s = defaultState(); s.levels.rl.step = 4; saveState(s)
  resetState()
  assert.deepEqual(loadState(), defaultState())
})

test('missing storage does not throw', () => {
  const saved = globalThis.localStorage
  globalThis.localStorage = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } }
  assert.deepEqual(loadState(), defaultState())
  assert.doesNotThrow(() => saveState(defaultState()))
  assert.doesNotThrow(() => resetState())
  globalThis.localStorage = saved
})
