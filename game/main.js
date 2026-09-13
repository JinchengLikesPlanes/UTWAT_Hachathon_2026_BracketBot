import * as THREE from './vendor/three/three.module.js'
import { GLTFLoader } from './vendor/three/loaders/GLTFLoader.js'
import { DRACOLoader } from './vendor/three/loaders/DRACOLoader.js'
import { STR } from './strings.js'
import { loadState } from './state.js'
import { createScene } from './scene.js'
import { buildRobot } from './robot.js'

const state = loadState()
const ui = document.getElementById('ui')
const view = createScene(document.getElementById('c'))
view.setDev(new URLSearchParams(location.search).has('dev'))

ui.textContent = STR.app.loading

const draco = new DRACOLoader().setDecoderPath('./vendor/three/libs/draco/gltf/')
const gltf = new GLTFLoader().setDRACOLoader(draco)
const loadMesh = file => new Promise((resolve, reject) => gltf.load(`./assets/robot/${file}`, g => resolve(g.scene), undefined, reject))

const json = await (await fetch('./assets/robot/robot.json')).json()
const robot = await buildRobot(json, { loadMesh })
view.zUp.add(robot.group)
window.bb = { robot, view, state, THREE }

ui.textContent = `${STR.app.title} — ${STR.hub.progress.replace('{n}', state.levels.pid.step)}`

let last = performance.now(), paused = false
addEventListener('blur', () => { paused = true })
addEventListener('focus', () => { paused = false; last = performance.now() })
function frame(now) {
  requestAnimationFrame(frame)
  if (paused) return
  last = now
  view.render()
}
requestAnimationFrame(frame)
