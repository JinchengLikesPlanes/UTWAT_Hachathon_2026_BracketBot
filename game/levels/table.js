// The ping-pong table both Level 2 and Level 3 play on (frame: x along the table from the paddle plane).
import * as R from '../sim/rally.js'

export const TABLE_H = 0.76

export function buildTable(THREE, view) {
  const g = new THREE.Group()
  const wood = new THREE.MeshStandardMaterial({ color: 0xffffff, map: view.texture('tex_table.png', 2), roughness: 0.7 })
  const top = new THREE.Mesh(new THREE.BoxGeometry(R.TABLE_LEN, 0.03, 1.525), wood)
  top.position.set(R.TABLE_LEN / 2, TABLE_H - 0.015, 0); top.receiveShadow = true; top.castShadow = true
  g.add(top)
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xffffff })
  for (const z of [-0.7625, 0.7625]) { const m = new THREE.Mesh(new THREE.BoxGeometry(R.TABLE_LEN, 0.032, 0.02), lineMat); m.position.set(R.TABLE_LEN / 2, TABLE_H - 0.015, z); g.add(m) }
  for (const x of [0.15, R.TABLE_LEN - 0.15]) for (const z of [-0.6, 0.6]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, TABLE_H, 0.05), new THREE.MeshStandardMaterial({ color: 0x333a48 })); leg.position.set(x, TABLE_H / 2, z); g.add(leg) }
  const net = new THREE.Mesh(new THREE.BoxGeometry(0.01, R.NET_H, 1.6), new THREE.MeshStandardMaterial({ color: 0xdddddd, transparent: true, opacity: 0.8 }))
  net.position.set(R.NET_X, TABLE_H + R.NET_H / 2, 0); g.add(net)
  return g
}
