// Renderer, camera, lights, floor. Render-on-demand: main.js owns the rAF loop.
import * as THREE from './vendor/three/three.module.js'

export const PHONE_WIDTH = 700

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
  renderer.setClearColor(0xfbf8f5)
  // Phones: no shadows, DPR 1. Decided once at start-up (toggling shadows at runtime re-compiles materials).
  const phoneAtStart = innerWidth < PHONE_WIDTH
  renderer.shadowMap.enabled = !phoneAtStart
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0xfbf8f5)
  scene.fog = new THREE.Fog(0xfbf8f5, 8, 22)

  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 60)
  camera.position.set(2.6, 1.5, 3.2)
  camera.lookAt(0, 0.7, 0)

  const hemi = new THREE.HemisphereLight(0xfff8f0, 0x8a7a68, 0.75)
  scene.add(hemi)
  const sun = new THREE.DirectionalLight(0xfff6ec, 2.6)
  sun.position.set(4, 5, 3)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  sun.shadow.camera.left = sun.shadow.camera.bottom = -4
  sun.shadow.camera.right = sun.shadow.camera.top = 4
  sun.shadow.camera.far = 20
  scene.add(sun)

  // Textures come from design/assets.csv (procedural fallback or generated art); a missing file
  // leaves the flat colour so the scene never shows a placeholder box.
  const texLoader = new THREE.TextureLoader()
  function texture(file, repeat = 1) {
    const t = texLoader.load(`./assets/${file}`)
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
    return t
  }
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: texture('tex_floor.png', 20), roughness: 1.0 })
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  scene.add(floor)

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

  // Camera preset. On a phone the scene must fit in the band between the top bar and the panel
  // (screen y 8 %–40 %): the camera backs off along its view line until `width` × `height` metres
  // fit there, and the look-at point drops so that band is centred on the target.
  const dir = new THREE.Vector3(), tgt = new THREE.Vector3()
  const BAND = 0.32, BAND_SHIFT = 0.26
  function lookAt(pos, target, { width = 0, height = 0 } = {}) {
    camera.position.set(...pos); tgt.set(...target)
    if (phone()) {
      const halfTan = Math.tan(camera.fov * Math.PI / 360)
      dir.copy(camera.position).sub(tgt)
      let d = dir.length()
      if (width > 0) d = Math.max(d, width / (2 * halfTan * camera.aspect))
      if (height > 0) d = Math.max(d, height / (2 * halfTan * BAND))
      dir.normalize()
      camera.position.copy(tgt).addScaledVector(dir, d)
      tgt.y -= BAND_SHIFT * 2 * d * halfTan
    }
    camera.lookAt(tgt)
  }

  return { renderer, scene, camera, zUp, floor, resize, render, setDev, lookAt, phone, texture }
}
