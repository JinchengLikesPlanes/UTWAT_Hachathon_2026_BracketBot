// Hub: a winding "learning path" — one big node per level with its step dots, like a language-app map.
import { STR } from './strings.js'
import { el, button, modal } from './ui.js'
import { resetState, defaultState, saveState } from './state.js'
import { audio } from './audio.js'
import { STEPS } from './levels/common.js'

const ORDER = ['pid', 'vision', 'rl']

export function showHub(app) {
  const { state, ui } = app
  ui.replaceChildren()
  const root = el('div', 'hub map')
  root.append(el('h1', '', STR.hub.title), el('p', 'sub', STR.hub.subtitle))
  const mission = el('div', 'mission')
  STR.hub.mission.forEach(t => mission.append(el('span', 'chip', t)))
  root.append(mission)
  const path = el('div', 'path')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', 'trail')
  const trail = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  const trailDone = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  trail.setAttribute('class', 'trail-bg'); trailDone.setAttribute('class', 'trail-done')
  svg.append(trail, trailDone)
  path.append(svg)

  // The first level not yet finished is "current"; earlier ones are done; later ones still open (teachers may pick any).
  const currentId = ORDER.find(id => !state.levels[id].done) ?? null
  const nodes = []
  ORDER.forEach((id, i) => {
    const s = STR.hub.levels[id], lv = state.levels[id], total = STEPS[id]
    const row = el('div', `row ${i % 2 ? 'right' : 'left'}`)
    const node = el('div', `node ${lv.done ? 'done' : id === currentId ? 'current' : ''}`)
    node.dataset.level = id
    const circle = button('', () => app.go(id), { cls: 'circle', id: `play-${id}` })
    circle.setAttribute('aria-label', `${STR.hub.play}: ${s.name}`)
    if (lv.done) { const img = el('img'); img.src = `./assets/spr_badge_${id}.png`; img.alt = STR.hub.badge; circle.append(img) }
    else circle.append(el('span', 'icon', s.icon))
    const info = el('div', 'info')
    info.append(el('h2', '', s.name), el('p', '', s.blurb))
    const dots = el('div', 'dots')
    for (let k = 1; k <= total; k++) dots.append(el('span', `dot ${lv.done || k < lv.step ? 'full' : k === lv.step && !lv.done ? 'now' : ''}`))
    const progress = el('div', 'progress', lv.done ? STR.hub.badge : STR.hub.progress.replace('{n}', lv.step).replace('{total}', total))
    const acts = el('div', 'actions')
    acts.append(
      button(lv.done ? STR.hub.play : lv.step > 1 ? STR.hub.resume : STR.hub.play, () => app.go(id), { primary: true, cls: 'small', id: `start-${id}` }),
      button(STR.hub.realRobot, () => showReal(app, id), { cls: 'small', id: `real-${id}` }),
    )
    info.append(dots, progress, acts)
    node.append(circle, info)
    row.append(node)
    path.append(row)
    nodes.push({ node, circle, done: lv.done })
  })
  root.append(path)
  const foot = el('div', 'foot')
  let armed = false
  const reset = button(STR.hub.reset, () => {
    if (!armed) { armed = true; reset.textContent = STR.hub.resetConfirm; reset.classList.add('danger'); setTimeout(() => { armed = false; reset.textContent = STR.hub.reset; reset.classList.remove('danger') }, 4000); return }
    resetState()
    Object.assign(app.state, defaultState())
    saveState(app.state)
    audio.play('fail')
    showHub(app)
  }, { cls: 'small', id: 'reset' })
  foot.append(reset)
  root.append(foot)
  ui.append(root)

  // Draw the winding trail through the circle centres (and the finished part of it in gold).
  const drawTrail = () => {
    const pr = path.getBoundingClientRect()
    const pts = nodes.map(n => { const r = n.circle.getBoundingClientRect(); return { x: r.left + r.width / 2 - pr.left, y: r.top + r.height / 2 - pr.top + path.scrollTop } })
    svg.setAttribute('width', pr.width); svg.setAttribute('height', path.scrollHeight)
    const seg = (a, b) => ` C ${a.x} ${(a.y + b.y) / 2}, ${b.x} ${(a.y + b.y) / 2}, ${b.x} ${b.y}`
    let d = `M ${pts[0].x} ${pts[0].y}`, dd = `M ${pts[0].x} ${pts[0].y}`
    for (let i = 1; i < pts.length; i++) { d += seg(pts[i - 1], pts[i]); if (nodes[i - 1].done) dd += seg(pts[i - 1], pts[i]) }
    trail.setAttribute('d', d); trailDone.setAttribute('d', nodes[0].done ? dd : '')
  }
  requestAnimationFrame(drawTrail)
  addEventListener('resize', drawTrail)
  app.onLeave = () => removeEventListener('resize', drawTrail)

  app.view.lookAt([1.6, 1.9, 4.6], [-1.7, 1.5, 0], { width: 2.0, height: 1.8 })
  app.robot.group.position.set(0, 0, 0)
  // idle: a friendly wave with the right arm
  let t = 0
  app.tick = dt => {
    t += dt
    app.robot.setJoint('rj1', 1.3)
    app.robot.setJoint('rj2', 0.35 * Math.sin(t * 4))
    app.robot.setJoint('rj3', -0.6 + 0.3 * Math.sin(t * 4 + 1))
    app.robot.setJoint('lj1', 0.15 * Math.sin(t * 1.3))
  }
}

export function showReal(app, id) {
  const r = STR.real[id]
  const m = modal({ title: r.title, lines: [r.lines], warn: r.warn, actions: [button(STR.common.close, () => m.remove(), { primary: true, id: 'close-real' })] })
  m.dataset.modal = 'real'
  app.ui.append(m)
  return m
}
