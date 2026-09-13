// Level 1 — Hold the Line. Real PID over a calibrated chassis; playback drives the URDF robot.
import { STR } from '../strings.js'
import { el, button, panel, slider, metrics, graph, feedback } from '../ui.js'
import { runTrial, DISTURBANCES, GAIN_LIMITS, REFERENCE_GAINS, DT, WHEEL_RADIUS } from '../sim/pid.js'
import { makeSpinner } from '../robot.js'
import { mountLevel, advance, conceptCheck, badgeScreen } from './common.js'
import { audio } from '../audio.js'

const S = () => STR.pid

export async function showLevel(app) {
  const { THREE, view, robot, state } = app
  const lv = state.levels.pid
  const L = mountLevel(app, 'pid', S().title)

  // --- scene dressing: target line + push arrow ---
  const dressing = new THREE.Group()
  const line = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.004, 1.4), new THREE.MeshStandardMaterial({ color: 0xffb547, emissive: 0x553300 }))
  line.position.y = 0.003
  dressing.add(line)
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(-0.9, 0.6, 0), 0.5, 0xf87171, 0.15, 0.1)
  arrow.visible = false
  dressing.add(arrow)
  view.scene.add(dressing)
  view.lookAt([0.5, 1.0, 2.9], [0.25, 0.7, 0], { width: 2.4, height: 1.8 })
  const wheels = ['left_wheel_tire__left_wheel_tire', 'right_wheel_tire__right_wheel_tire'].map(n => makeSpinner(robot, n))
  const cleanup = () => { view.scene.remove(dressing); app.tick = null }

  // --- playback of a finished trial ---
  let play = null   // { trajectory, t, done, onFrame, onDone, speed }
  app.tick = dt => {
    if (!play || play.done) return
    play.t += dt * play.speed
    const idx = Math.min(play.trajectory.length - 1, Math.floor(play.t / DT))
    const p = play.trajectory[idx]
    robot.group.position.x = p.x
    for (const w of wheels) w.setAngle(p.x / WHEEL_RADIUS)
    arrow.visible = p.force > 0
    play.onFrame(idx)
    if (idx >= play.trajectory.length - 1) { play.done = true; arrow.visible = false; play.onDone() }
  }

  const gains = { ...lv.gains }
  const disturbanceLabel = id => S().disturbances[id]

  // Builds the shared experiment panel for steps 1-5. opts: { title, lead, note, sliders:[...], disturbance, onResult(metrics, run) }
  function experiment(opts) {
    const canvas = el('canvas', 'graph')
    const g = graph(canvas, { yRange: [-0.35, 0.35], tRange: [0, 8], yLines: [-0.05, 0.05] })
    const bars = metrics([
      { id: 'p', label: 'P', value: '0.00' }, { id: 'i', label: 'I', value: '0.00' }, { id: 'd', label: 'D', value: '0.00' },
    ])
    const result = el('div')
    const fb = el('div')
    const sliders = {}
    const makeSlider = k => slider({
      label: S().gains[k], min: GAIN_LIMITS[k][0], max: GAIN_LIMITS[k][1], step: 0.05, value: gains[k], id: k,
      format: v => v.toFixed(2), onInput: v => { gains[k] = v; lv.gains = { ...gains }; app.save(); opts.onGainChange?.() },
    })
    for (const k of opts.sliders) sliders[k] = makeSlider(k)
    const pick = el('div', 'row')
    let disturbance = opts.disturbance
    if (opts.pickDisturbance) {
      for (const id of Object.keys(DISTURBANCES)) {
        const b = button(disturbanceLabel(id), () => { disturbance = id; pick.querySelectorAll('button').forEach(x => x.classList.toggle('selected', x === b)) }, { cls: 'small', id: `dist-${id}` })
        if (id === disturbance) b.classList.add('selected')
        pick.append(b)
      }
    }
    const runBtn = button(opts.pickDisturbance ? STR.common.run : `${STR.common.run} · ${disturbanceLabel(disturbance)}`, () => start(), { primary: true, id: 'run' })
    const skipBtn = button(S().skip, () => { if (play) play.speed = 40 }, { cls: 'small', id: 'skip' })
    skipBtn.disabled = true
    const next = button(STR.common.next, () => opts.onNext(), { primary: true, id: 'next' })
    next.hidden = true

    const spec = () => DISTURBANCES[disturbance]
    const drawUpTo = (traj, idx) => {
      g.draw([{ points: traj.slice(0, idx + 1).map(p => ({ t: p.t, y: p.x })), color: '#ffb547' }],
        [{ t0: spec().start, t1: spec().end, color: 'rgba(248,113,113,.18)' }])
      const p = traj[idx]
      bars.querySelector('[data-id=p] .v').textContent = p.p.toFixed(2)
      bars.querySelector('[data-id=i] .v').textContent = p.i.toFixed(2)
      bars.querySelector('[data-id=d] .v').textContent = p.d.toFixed(2)
    }
    function start() {
      const run = runTrial(gains, disturbance)
      runBtn.disabled = true; skipBtn.disabled = false
      Object.values(sliders).forEach(s => s.lock(true))
      result.replaceChildren(); fb.replaceChildren()
      audio.play('hit')
      play = {
        trajectory: run.trajectory, t: 0, done: false, speed: 1,
        onFrame: idx => drawUpTo(run.trajectory, idx),
        onDone: () => {
          runBtn.disabled = false; skipBtn.disabled = true
          Object.values(sliders).forEach(s => s.lock(false))
          const m = run.metrics
          result.replaceChildren(metrics([
            { id: 'max', label: S().metrics.max, value: `${m.maxErrorCm} cm` },
            { id: 'over', label: S().metrics.overshoot, value: `${m.overshootCm} cm` },
            { id: 'tail', label: S().metrics.tail, value: `${m.tailErrorCm} cm`, kind: m.stable ? 'good' : 'bad' },
          ]))
          const verdict = opts.onResult(m, { gains: { ...gains }, disturbance })
          if (verdict) fb.append(feedback(verdict.text, verdict.kind))
          if (verdict?.pass) { next.hidden = false; audio.play('pass') }
        },
      }
    }
    g.draw([], [{ t0: spec().start, t1: spec().end, color: 'rgba(248,113,113,.18)' }])
    const p = panel({ title: opts.title, lead: opts.lead, note: opts.note, body: [pick, ...Object.values(sliders), canvas, bars, result, fb], actions: [runBtn, skipBtn, next] })
    if (!opts.pickDisturbance) pick.remove()
    return p
  }

  const steps = {
    1: () => experiment({
      title: S().steps[1].title, lead: S().steps[1].lead, note: S().steps[1].note, sliders: [], disturbance: 'push',
      onResult: m => ({ pass: true, kind: 'info', text: S().steps[1].result.replace('{cm}', m.finalErrorCm) }),
      onNext: () => { advance(app, 'pid', 2); go(2) },
    }),
    2: () => experiment({
      title: S().steps[2].title, lead: S().steps[2].lead, note: S().steps[2].note, sliders: ['kp'], disturbance: 'push',
      onResult: (m, run) => {
        if (run.gains.kp <= 0) return { pass: false, kind: 'bad', text: S().steps[2].needP }
        lv.bestPOnly = Math.min(lv.bestPOnly ?? Infinity, m.overshootCm)
        app.save()
        return { pass: true, kind: 'good', text: S().steps[2].result.replace('{over}', m.overshootCm) }
      },
      onNext: () => { advance(app, 'pid', 3); go(3) },
    }),
    3: () => experiment({
      title: S().steps[3].title, lead: S().steps[3].lead.replace('{best}', lv.bestPOnly ?? '?'), note: S().steps[3].note, sliders: ['kp', 'kd'], disturbance: 'push',
      onResult: (m, run) => {
        if (run.gains.kd <= 0) return { pass: false, kind: 'bad', text: S().steps[3].needD }
        const best = lv.bestPOnly ?? Infinity
        if (m.overshootCm < best) return { pass: true, kind: 'good', text: S().steps[3].result.replace('{over}', m.overshootCm).replace('{best}', best) }
        return { pass: false, kind: 'bad', text: S().steps[3].worse.replace('{over}', m.overshootCm).replace('{best}', best) }
      },
      onNext: () => { advance(app, 'pid', 4); go(4) },
    }),
    4: () => experiment({
      title: S().steps[4].title, lead: S().steps[4].lead, note: S().steps[4].note, sliders: ['kp', 'ki', 'kd'], disturbance: 'steady_pull',
      onResult: (m, run) => {
        if (run.gains.ki <= 0) return { pass: false, kind: m.stable ? 'info' : 'bad', text: S().steps[4].needI.replace('{tail}', m.tailErrorCm) }
        if (m.stable) return { pass: true, kind: 'good', text: S().steps[4].result }
        return { pass: false, kind: 'bad', text: S().steps[4].notYet.replace('{tail}', m.tailErrorCm) }
      },
      onNext: () => { advance(app, 'pid', 5); go(5) },
    }),
    5: () => exam(),
    6: () => conceptCheck(app, 'pid', S().concept, () => go(7)),
    7: () => badgeScreen(app, 'pid', S().badge),
  }

  // Step 5: one gain set must hold all three disturbances. Changing a gain clears the board.
  function exam() {
    const board = {}
    const cells = metrics(Object.keys(DISTURBANCES).map(id => ({ id, label: disturbanceLabel(id), value: '—' })))
    const refresh = () => {
      for (const id of Object.keys(DISTURBANCES)) {
        const c = cells.querySelector(`[data-id=${id}]`)
        const r = board[id]
        c.className = `metric ${r ? (r.stable ? 'good' : 'bad') : ''}`
        c.querySelector('.v').textContent = r ? (r.stable ? '✓' : `✗ ${r.tailErrorCm} cm`) : '—'
      }
    }
    const hint = el('div')
    const p = experiment({
      title: S().steps[5].title, lead: S().steps[5].lead, note: S().steps[5].note, sliders: ['kp', 'ki', 'kd'], disturbance: 'push', pickDisturbance: true,
      onGainChange: () => { for (const k in board) delete board[k]; refresh() },
      onResult: (m, run) => {
        board[run.disturbance] = m
        refresh()
        const all = Object.keys(DISTURBANCES).every(id => board[id]?.stable)
        if (all) return { pass: true, kind: 'good', text: S().steps[5].result }
        if (!m.stable) {
          lv.examFails = (lv.examFails ?? 0) + 1
          app.save()
          if (lv.examFails >= 3) hint.replaceChildren(feedback(S().steps[5].hint.replace('{kp}', REFERENCE_GAINS.kp).replace('{ki}', REFERENCE_GAINS.ki).replace('{kd}', REFERENCE_GAINS.kd), 'info'))
          return { pass: false, kind: 'bad', text: S().steps[5].failed.replace('{tail}', m.tailErrorCm) }
        }
        return { pass: false, kind: 'info', text: S().steps[5].partial }
      },
      onNext: () => go(6),
    })
    p.insertBefore(cells, p.actionsEl)
    p.insertBefore(hint, p.actionsEl)
    return p
  }

  function go(n) {
    play = null
    robot.group.position.x = 0
    L.setStep(n)
    L.show(steps[n]())
  }
  go(lv.done ? 1 : Math.min(lv.step, 5))
  app.onLeave = cleanup
}
