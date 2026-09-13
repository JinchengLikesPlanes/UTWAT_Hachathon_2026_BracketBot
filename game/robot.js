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

// The wheel axle in the root frame: base_plate's origin (x, z); the axle runs along root Y.
export const AXLE = { x: 0.0113, z: 0.0776 }

// Spin a link's visual about an axis given in the robot's root frame. The pivot is the mesh's
// bounding-box centre projected onto the axle line (so a tyre turns about the axle, not its own
// bounding box). Used for the wheels: the URDF fixes them, so the game rotates the tyre mesh.
export function makeSpinner(robot, linkName, axisRoot = new THREE.Vector3(0, 1, 0), onAxle = true, { carry = [] } = {}) {
  const link = robot.links.get(linkName)
  const holder = link.children.find(c => c.name.endsWith(':visual'))
  if (!holder) return { setAngle() {} }
  robot.group.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(holder, true)
  const centreWorld = box.getCenter(new THREE.Vector3())
  if (onAxle) {
    const centreRoot = robot.group.worldToLocal(centreWorld.clone())
    centreRoot.x = AXLE.x; centreRoot.z = AXLE.z
    robot.group.localToWorld(centreWorld.copy(centreRoot))
  }
  const centreLocal = link.worldToLocal(centreWorld.clone())
  const rootQuat = robot.group.getWorldQuaternion(new THREE.Quaternion())
  const linkQuat = link.getWorldQuaternion(new THREE.Quaternion())
  const linkInv = linkQuat.invert()
  const axisLocal = axisRoot.clone().applyQuaternion(rootQuat).applyQuaternion(linkInv).normalize()
  const upLocal = new THREE.Vector3(0, 0, 1).applyQuaternion(rootQuat).applyQuaternion(linkInv).normalize()   // root Z (up)
  const pivot = new THREE.Group()
  pivot.position.copy(centreLocal)
  link.add(pivot)
  pivot.attach(holder)
  // a head carries its camera with it: named child links ride the pivot too
  for (const name of carry) { const c = robot.links.get(name); if (c && c.parent === link) pivot.attach(c) }
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion()
  return {
    setAngle: a => pivot.setRotationFromAxisAngle(axisLocal, a),
    // angle about the given axis plus a turn about the robot's up axis (a head that nods and looks around)
    setAngles: (a, turn) => pivot.quaternion.copy(qa.setFromAxisAngle(upLocal, turn)).multiply(qb.setFromAxisAngle(axisLocal, a)),
  }
}
