// Shared level plumbing: top bar, step navigation, concept check, badge, real-robot card.
import { STR } from '../strings.js'
import { el, button, topbar, panel, choice, feedback, modal } from '../ui.js'
import { showReal } from '../hub.js'
import { audio } from '../audio.js'

export const STEPS = { pid: 5, rl: 7, vision: 5 }

export function mountLevel(app, id, title) {
  app.ui.replaceChildren()
  const bar = topbar(title, '', () => app.go('hub'), STR.common.hub)
  app.ui.append(bar)
  const total = STEPS[id]
  const setStep = n => bar.setSteps(n <= total ? STR.common.step.replace('{n}', n).replace('{total}', total) : STR.common.concept)
  let current = null
  const show = p => { current?.remove(); current = p; app.ui.append(p) }
  return { bar, setStep, show }
}

export function advance(app, id, to) {
  const lv = app.state.levels[id]
  lv.step = Math.max(lv.step, to)
  app.save()
}

// Multiple-choice concept check. q = { question, options, answer, explain }. onPass() after a correct answer.
export function conceptCheck(app, id, q, onPass) {
  const lv = app.state.levels[id]
  const fb = el('div')
  let c
  const p = panel({ title: STR.common.concept, lead: q.question, body: [] })
  c = choice(q.options, (i, b) => {
    fb.replaceChildren()
    if (i === q.answer) {
      c.lock(); c.mark(i, true)
      fb.append(feedback(`${STR.common.correct} ${q.explain}`, 'good'))
      audio.play('pass')
      lv.done = true
      app.save()
      p.actionsEl.append(button(STR.common.next, onPass, { primary: true, id: 'next' }))
    } else {
      c.mark(i, false); b.disabled = true
      fb.append(feedback(STR.common.wrong, 'bad'))
      audio.play('fail')
    }
  })
  p.insertBefore(c, p.actionsEl)
  p.insertBefore(fb, p.actionsEl)
  return p
}

export function badgeScreen(app, id, text) {
  audio.play('badge')
  const img = el('img', 'badge-img'); img.src = `./assets/spr_badge_${id}.png`; img.alt = STR.common.badgeTitle
  const p = panel({ title: STR.common.badgeTitle, lead: text, body: [img] })
  p.actionsEl.append(
    button(STR.common.realRobot, () => showReal(app, id), { id: 'real' }),
    button(STR.common.backToHub, () => app.go('hub'), { primary: true, id: 'to-hub' }),
  )
  return p
}
