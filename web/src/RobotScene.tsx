import { useEffect, useRef } from 'react'
import * as THREE from 'three'

// 'hero' is the home page: the robot alone on a white ground, arm swaying.
type Props = { mode: 'pid' | 'rl' | 'hero'; position?: number; active?: boolean }

export default function RobotScene({ mode, position = 0, active = false }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const robotRef = useRef<THREE.Group | null>(null)
  const targetRef = useRef<THREE.Mesh | null>(null)

  useEffect(() => {
    if (!host.current) return
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#ffffff')
    scene.fog = new THREE.Fog('#ffffff', 7, 15)
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50)
    camera.up.set(0, 0, 1)
    if (mode === 'hero') { camera.position.set(4.4, 3.0, 2.6); camera.lookAt(0, 0, 0.8) }
    else { camera.position.set(5.2, 3.7, 4.1); camera.lookAt(0, 0, 0.7) }
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75))
    renderer.shadowMap.enabled = true
    renderer.outputColorSpace = THREE.SRGBColorSpace
    host.current.appendChild(renderer.domElement)

    scene.add(new THREE.HemisphereLight('#ffffff', '#8a7a68', 1.5))
    const key = new THREE.DirectionalLight('#ffffff', 2.2)
    key.position.set(4, -2, 7); key.castShadow = true; scene.add(key)
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(4.8, 4.8, .12, 64), new THREE.MeshStandardMaterial({ color: '#F4EFE8', roughness: 1 }))
    floor.rotation.x = Math.PI / 2; floor.position.z = -.06; floor.receiveShadow = true; scene.add(floor)   // cylinder axis is Y: lay it flat on the Z-up ground
    const grid = new THREE.GridHelper(8, 16, '#D9D0C4', '#E8E1D7'); grid.rotation.x = Math.PI / 2; grid.position.z = .004; scene.add(grid)

    const robot = buildRobot(); robotRef.current = robot; scene.add(robot)
    if (mode === 'pid') {
      const ring = new THREE.Mesh(new THREE.RingGeometry(.55, .62, 64), new THREE.MeshBasicMaterial({ color: '#171717', side: THREE.DoubleSide }))
      ring.position.z = .012; targetRef.current = ring; scene.add(ring)
    } else if (mode === 'rl') {
      const table = new THREE.Mesh(new THREE.BoxGeometry(3.7, 2, .12), new THREE.MeshStandardMaterial({ color: '#4B4641', roughness: .6 }))
      table.position.set(.65, 0, .73); table.castShadow = true; scene.add(table)
      const net = new THREE.Mesh(new THREE.BoxGeometry(.035, 2.08, .34), new THREE.MeshStandardMaterial({ color: '#171717', wireframe: true }))
      net.position.set(.65, 0, .96); scene.add(net)
      robot.position.x = -1.7
    }

    let frame = 0
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host.current!
      renderer.setSize(w, h, false); camera.aspect = w / Math.max(h, 1); camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize); observer.observe(host.current); resize()
    const loop = () => { frame = requestAnimationFrame(loop); const now = performance.now(); robot.children[5].rotation.z = mode === 'hero' ? Math.sin(now / 900) * .18 : active ? Math.sin(now / 300) * .12 : 0; renderer.render(scene, camera) }
    loop()
    ;(window as any).__THREE_GAME_DIAGNOSTICS__ = { renderer: renderer.info, scene: { mode, objects: scene.children.length } }
    return () => { cancelAnimationFrame(frame); observer.disconnect(); renderer.dispose(); host.current?.replaceChildren() }
  }, [mode])

  useEffect(() => { if (robotRef.current && mode === 'pid') robotRef.current.position.x = position * 6 }, [position, mode])
  return <div className="scene" ref={host} role="img" aria-label={mode === 'hero' ? '3D BracketBot' : `3D BracketBot ${mode === 'pid' ? 'position control' : 'ping-pong'} simulation`} />
}

function buildRobot() {
  const group = new THREE.Group()
  const dark = new THREE.MeshStandardMaterial({ color: '#2a2724', roughness: .48, metalness: .45 })
  const shell = new THREE.MeshStandardMaterial({ color: '#f1ede6', roughness: .35, metalness: .12 })
  const orange = new THREE.MeshStandardMaterial({ color: '#a0402f', roughness: .38 })
  const base = new THREE.Mesh(new THREE.CylinderGeometry(.48, .56, .34, 12), dark); base.rotation.x = Math.PI / 2; base.position.z = .28; group.add(base)
  for (const y of [-.46, .46]) { const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.24, .24, .12, 24), dark); wheel.rotation.x = Math.PI / 2; wheel.position.set(0, y, .23); wheel.castShadow = true; group.add(wheel) }
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.3, .55, 5, 12), shell); torso.rotation.x = Math.PI / 2; torso.position.z = .85; torso.castShadow = true; group.add(torso)
  const head = new THREE.Mesh(new THREE.SphereGeometry(.34, 24, 16), shell); head.scale.z = .72; head.position.z = 1.45; group.add(head)
  const arm = new THREE.Group(); arm.position.set(.05, -.29, 1.13); group.add(arm)
  let parent = arm
  for (let i = 0; i < 3; i++) { const joint = new THREE.Mesh(new THREE.SphereGeometry(.11, 16, 12), orange); parent.add(joint); const link = new THREE.Mesh(new THREE.CapsuleGeometry(.075, .34, 5, 10), dark); link.rotation.z = Math.PI / 2; link.position.x = .25; joint.add(link); const next = new THREE.Group(); next.position.x = .5; joint.add(next); parent = next }
  const paddle = new THREE.Mesh(new THREE.CylinderGeometry(.22, .22, .035, 28), orange); paddle.rotation.x = Math.PI / 2; paddle.position.x = .12; parent.add(paddle)
  group.traverse(obj => { if (obj instanceof THREE.Mesh) { obj.castShadow = true; obj.receiveShadow = true } })
  return group
}
