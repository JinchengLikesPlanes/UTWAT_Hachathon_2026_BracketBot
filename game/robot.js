// Builds the BracketBot from robot.json (baked from the URDF by tools/bake_urdf.py).
//
// Per link:  parent.jointGroup ─▶ origin (URDF joint origin, rpy as fixed-axis XYZ)
//                                    └▶ jointGroup (rotation.z / position.z = joint value)
//                                          ├▶ visual (mesh, with its own visual origin)
//                                          └▶ children …
// The frames here are URDF frames (Z up). scene.js rotates the whole group into Y up.
import * as THREE from './vendor/three/three.module.js'

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

export async function buildRobot(json, { loadMesh } = {}) {
  const links = new Map()   // name → jointGroup (the link frame)
  const joints = new Map()  // name → { link, type, lower, upper, value, mimics: [] }
  let root = null

  for (const l of json.links) {
    const origin = new THREE.Group()
    origin.name = `${l.name}:origin`
    origin.position.set(...l.xyz)
    origin.rotation.set(l.rpy[0], l.rpy[1], l.rpy[2], 'ZYX')

    const frame = new THREE.Group()
    frame.name = l.name
    origin.add(frame)
    links.set(l.name, frame)

    if (l.parent) links.get(l.parent).add(origin)
    else root = origin

    if (l.joint && l.joint.type !== 'fixed') {
      joints.set(l.joint.name, {
        link: frame, type: l.joint.type, lower: l.joint.lower, upper: l.joint.upper,
        value: 0, mimic: l.joint.mimic, mimics: [],
      })
    }

    if (l.mesh && loadMesh) {
      const mesh = await loadMesh(l.mesh)
      if (mesh) {
        const holder = new THREE.Group()
        holder.name = `${l.name}:visual`
        if (l.visual) {
          holder.position.set(...l.visual.xyz)
          holder.rotation.set(l.visual.rpy[0], l.visual.rpy[1], l.visual.rpy[2], 'ZYX')
        }
        const color = new THREE.Color(...l.color)
        mesh.traverse(o => {
          if (o.isMesh) {
            o.material = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 })
            o.castShadow = true
            o.receiveShadow = true
          }
        })
        holder.add(mesh)
        frame.add(holder)
      }
    }
  }

  for (const j of joints.values()) if (j.mimic) joints.get(j.mimic.joint).mimics.push(j)

  function apply(j, value) {
    j.value = value
    if (j.type === 'prismatic') j.link.position.z = value
    else j.link.rotation.z = value
    for (const m of j.mimics) apply(m, value * m.mimic.multiplier + m.mimic.offset)
  }

  function setJoint(name, value) {
    const j = joints.get(name)
    if (!j) throw new Error(`unknown joint ${name}`)
    const v = clamp(value, j.lower, j.upper)
    apply(j, v)
    return v
  }

  const group = new THREE.Group()
  group.name = 'bracketbot'
  group.add(root)
  return { group, links, joints, setJoint }
}
