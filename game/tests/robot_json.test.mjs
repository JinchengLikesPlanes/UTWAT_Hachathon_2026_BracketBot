import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const dir = join(here, '..', 'assets', 'robot')
const json = JSON.parse(readFileSync(join(dir, 'robot.json'), 'utf8'))

test('54 links, one root named root', () => {
  assert.equal(json.links.length, 54)
  const roots = json.links.filter(l => l.parent === null)
  assert.equal(roots.length, 1)
  assert.equal(roots[0].name, 'root')
})

test('parents come before children', () => {
  const seen = new Set()
  for (const l of json.links) {
    if (l.parent) assert.ok(seen.has(l.parent), `${l.name} before ${l.parent}`)
    seen.add(l.name)
  }
})

test('18 movable joints, all with limits', () => {
  const movable = json.links.filter(l => l.joint && l.joint.type !== 'fixed')
  assert.equal(movable.length, 18)
  for (const l of movable) {
    assert.ok(typeof l.joint.lower === 'number' && typeof l.joint.upper === 'number', l.joint.name)
  }
  assert.equal(movable.filter(l => l.joint.mimic).length, 2)
})

test('every mesh file exists', () => {
  const meshes = json.links.filter(l => l.mesh)
  assert.equal(meshes.length, 50)
  for (const l of meshes) assert.ok(existsSync(join(dir, l.mesh)), l.mesh)
})

test('check block covers the named links', () => {
  for (const n of ['right_eef', 'left_eef', 'head__head__head__head']) {
    assert.ok(Array.isArray(json.check[n]) && json.check[n].length === 3)
    assert.ok(json.links.some(l => l.name === n))
  }
})
