import * as THREE from './vendor/three/three.module.js'
import { GLTFLoader } from './vendor/three/loaders/GLTFLoader.js'
import { DRACOLoader } from './vendor/three/loaders/DRACOLoader.js'
import { STR } from './strings.js'
import { loadState, saveState } from './state.js'
import { createScene } from './scene.js'
import { buildRobot } from './robot.js'
import { pollGamepad } from './ui.js'
import { showHub } from './hub.js'

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

const screens = {
  hub: showHub,
  pid: async app => (await import('./levels/pid.js')).showLevel(app),
  rl: async app => (await import('./levels/rl.js')).showLevel(app),
  vision: async app => (await import('./levels/vision.js')).showLevel(app),
}

const app = {
  THREE, view, robot, ui, state: loadState(), screen: 'hub',
  tick: null,                       // per-screen update(dtSeconds) hook
  save() { saveState(app.state) },
  async go(name) {
    app.onLeave?.(); app.onLeave = null
    app.tick = null
    app.screen = name
    for (const j of robot.joints.keys()) robot.setJoint(j, 0)
    await screens[name](app)
  },
}
window.bb = app

const STEP = 1 / 60
let last = performance.now(), acc = 0, paused = false
addEventListener('blur', () => { paused = true })
addEventListener('focus', () => { paused = false; last = performance.now() })
function frame(now) {
  requestAnimationFrame(frame)
  if (paused) return
  acc += Math.min(0.25, (now - last) / 1000); last = now
  while (acc >= STEP) { app.tick?.(STEP); acc -= STEP }
  pollGamepad()
  view.render()
}
requestAnimationFrame(frame)

await app.go('hub')
