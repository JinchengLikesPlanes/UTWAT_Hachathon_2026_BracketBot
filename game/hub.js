import { STR } from './strings.js'
import { el, button, modal } from './ui.js'
import { resetState, defaultState, saveState } from './state.js'
import { audio } from './audio.js'

export function showHub(app) {
  const { state, ui } = app
  ui.replaceChildren()
  const root = el('div', 'hub')
  root.append(el('h1', '', STR.hub.title), el('p', 'sub', STR.hub.subtitle))
  const grid = el('div', 'levels')
  for (const id of ['pid', 'rl', 'vision']) {
    const s = STR.hub.levels[id], lv = state.levels[id]
    const card = el('article', 'level')
    card.dataset.level = id
    card.append(el('div', 'badge', lv.done ? '🏅' : s.icon), el('h2', '', s.name), el('p', '', s.blurb))
    card.append(el('div', 'progress', lv.done ? STR.hub.badge : STR.hub.progress.replace('{n}', lv.step)))
    const acts = el('div', 'actions')
    const playLabel = lv.done ? STR.hub.play : lv.step > 1 ? STR.hub.resume : STR.hub.play
    acts.append(button(playLabel, () => app.go(id), { primary: true, id: `play-${id}` }))
    acts.append(button(STR.hub.realRobot, () => showReal(app, id), { id: `real-${id}` }))
    card.append(acts)
    grid.append(card)
  }
  root.append(grid)
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
  app.view.lookAt([2.4, 1.1, 3.0], [0, 1.6, 0], { width: 2.0, height: 1.8 })
  app.robot.group.position.set(0, 0, 0)
}

export function showReal(app, id) {
  const r = STR.real[id]
  const m = modal({ title: r.title, lines: [r.lines], warn: r.warn, actions: [button(STR.common.close, () => m.remove(), { primary: true, id: 'close-real' })] })
  m.dataset.modal = 'real'
  app.ui.append(m)
  return m
}
