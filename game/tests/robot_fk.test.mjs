import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as THREE from '../vendor/three/three.module.js'
import { buildRobot } from '../robot.js'

const here = dirname(fileURLToPath(import.meta.url))
const json = JSON.parse(readFileSync(join(here, '..', 'assets', 'robot', 'robot.json'), 'utf8'))

function world(robot, name) {
  robot.group.updateMatrixWorld(true)
  return new THREE.Vector3().setFromMatrixPosition(robot.links.get(name).matrixWorld)
}

test('zero pose matches python FK', async () => {
  const robot = await buildRobot(json, { loadMesh: () => null })
  for (const [name, p] of Object.entries(json.check)) {
    const v = world(robot, name)
    for (const [i, k] of ['x', 'y', 'z'].entries()) assert.ok(Math.abs(v[k] - p[i]) < 1e-6, `${name}.${k}: ${v[k]} vs ${p[i]}`)
  }
})

test('rj0 slides the arm along the shoulder local Z', async () => {
  const robot = await buildRobot(json, { loadMesh: () => null })
  const before = world(robot, 'right_eef')
  robot.setJoint('rj0', -0.5)
  const after = world(robot, 'right_eef')
  const shoulder = robot.links.get('shoulder__shoulder')
  const axis = new THREE.Vector3(0, 0, 1).transformDirection(shoulder.parent.matrixWorld)
  const delta = after.clone().sub(before)
  assert.ok(Math.abs(delta.length() - 0.5) < 1e-6, `moved ${delta.length()}`)
  assert.ok(Math.abs(delta.dot(axis) + 0.5) < 1e-6, 'moved along -axis')
})

test('joints clamp to limits and mimic follows', async () => {
  const robot = await buildRobot(json, { loadMesh: () => null })
  assert.equal(robot.setJoint('rj0', 5), 0)
  assert.equal(robot.setJoint('rj1', -9), -2.094395)
  robot.setJoint('right_left_gripper', 0.7)
  assert.equal(robot.joints.get('right_right_gripper').value, 0.7)
  assert.equal(robot.joints.size, 18)
})
