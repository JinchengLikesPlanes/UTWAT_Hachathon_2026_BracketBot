// Renderer, camera, lights, floor. Render-on-demand: main.js owns the rAF loop.
import * as THREE from './vendor/three/three.module.js'

export const PHONE_WIDTH = 700

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
  renderer.setClearColor(0x10141c)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x10141c)
  scene.fog = new THREE.Fog(0x10141c, 8, 22)

  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 60)
  camera.position.set(2.6, 1.5, 3.2)
  camera.lookAt(0, 0.7, 0)

  const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x3a3226, 0.9)
  scene.add(hemi)
  const sun = new THREE.DirectionalLight(0xffffff, 2.2)
  sun.position.set(3, 6, 2)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  sun.shadow.camera.left = sun.shadow.camera.bottom = -4
  sun.shadow.camera.right = sun.shadow.camera.top = 4
  sun.shadow.camera.far = 20
  scene.add(sun)

  const floorMat = new THREE.MeshStandardMaterial({ color: 0x2b3140, roughness: 0.95 })
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  scene.add(floor)
  const grid = new THREE.GridHelper(40, 40, 0x46506a, 0x353c4e)
  grid.position.y = 0.001
  scene.add(grid)

  // URDF is Z-up; Three is Y-up. Everything from the URDF hangs under this group.
  const zUp = new THREE.Group()
  zUp.rotation.x = -Math.PI / 2
  scene.add(zUp)

  const dev = document.getElementById('dev')
  let devOn = false, frames = 0, fpsAt = performance.now()

  function phone() { return innerWidth < PHONE_WIDTH }

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, phone() ? 1.0 : 1.5)
    renderer.setPixelRatio(dpr)
    renderer.setSize(innerWidth, innerHeight, true)
    renderer.shadowMap.enabled = !phone()
    floorMat.needsUpdate = true
    camera.aspect = innerWidth / innerHeight
    camera.updateProjectionMatrix()
  }
  addEventListener('resize', resize)
  addEventListener('orientationchange', resize)
  resize()

  function render() {
    renderer.render(scene, camera)
    if (devOn) {
      frames++
      const now = performance.now()
      if (now - fpsAt >= 500) {
        const fps = Math.round(frames * 1000 / (now - fpsAt))
        frames = 0; fpsAt = now
        dev.textContent = `${fps} fps · ${renderer.info.render.calls} calls · ${renderer.info.render.triangles} tris`
        dev.dataset.fps = fps
      }
    }
  }

  function setDev(on) { devOn = on; dev.hidden = !on }

  // Camera presets per screen; levels tween toward these.
  function lookAt(pos, target) { camera.position.set(...pos); camera.lookAt(...target) }

  return { renderer, scene, camera, zUp, floor, resize, render, setDev, lookAt, phone }
}
