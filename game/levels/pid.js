// Level 1 — Hold the Line. BracketBot as a two-wheeled balancer: a real PID cascade
// (balance P/D over a hold loop with I) drives a calibrated inverted pendulum; playback poses the URDF.
import { STR } from '../strings.js'
import { el, button, panel, slider, metrics, graph, feedback, popup } from '../ui.js'
import { runTrial, DISTURBANCES, GAIN_LIMITS, REFERENCE_GAINS, DT, WHEEL_RADIUS } from '../sim/pid.js'
import { makeSpinner, AXLE } from '../robot.js'
import { mountLevel, advance, conceptCheck, badgeScreen } from './common.js'
import { audio } from '../audio.js'

const S = () => STR.pid
const EXAM = ['push', 'long_push', 'steady_pull']

export async function showLevel(app) {
  const { THREE, view, robot, state } = app
  const lv = state.levels.pid
  const L = mountLevel(app, 'pid', S().title)

  // --- scene: pivot at the axle so the whole robot tips; target line; push arrow ---
  const pivot = new THREE.Group()
  const inner = new THREE.Group(); inner.rotation.x = -Math.PI / 2   // URDF Z-up inside the pivot
  pivot.position.y = AXLE.z
  robot.group.position.set(-AXLE.x, 0, -AXLE.z)   // URDF frame: put the axle at the pivot
  inner.add(robot.group); pivot.add(inner); view.scene.add(pivot)
  const dressing = new THREE.Group()
  const line = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.004, 1.4), new THREE.MeshStandardMaterial({ color: 0xffb547, emissive: 0x553300 }))
  line.position.y = 0.003
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(-0.7, 1.0, 0), 0.45, 0xf87171, 0.15, 0.1)
  arrow.visible = false
  dressing.add(line, arrow)
  view.scene.add(dressing)
  const camPos = [-0.55, 1.1, -3.9], camTgt = [-0.55, 0.65, 0]   // from the robot's left: +x (its front) is screen-left
  view.lookAt(camPos, camTgt, { width: 2.6, height: 1.8 })
  const camX0 = view.camera.position.x
  const wheels = ['left_wheel_tire__left_wheel_tire', 'right_wheel_tire__right_wheel_tire'].map(n => makeSpinner(robot, n))
  const setPose = (x, th) => {
    pivot.position.x = x; pivot.rotation.z = -th
    for (const w of wheels) w.setAngle(x / WHEEL_RADIUS)
    // camera follows the robot along the line (it can run off by metres)
    const follow = Math.abs(x) > 0.6 ? x - Math.sign(x) * 0.6 : 0
    view.camera.position.x = camX0 + follow
    arrow.position.x = x - 0.7
  }
  const cleanup = () => {
    view.scene.remove(dressing); view.scene.remove(pivot)
    robot.group.position.set(0, 0, 0); robot.group.rotation.set(0, 0, 0); view.zUp.add(robot.group)
    for (const w of wheels) w.setAngle(0)
    app.tick = null
  }

  // --- playback ---
  let play = null
  app.tick = dt => {
    if (!play || play.done) return
    play.t += dt * play.speed
    const idx = Math.min(play.trajectory.length - 1, Math.floor(play.t / DT))
    const p = play.trajectory[idx]
    setPose(p.x, p.th)
    arrow.visible = p.force > 0
    if (p.fallen && !play.thud) { play.thud = true; audio.play('fail') }
    play.onFrame(idx)
    if (idx >= play.trajectory.length - 1) { play.done = true; arrow.visible = false; play.onDone() }
  }

  const gains = { kp: 0, kd: 0, kh: 0, ki: 0, ...lv.gains }
  const dLabel = id => S().disturbances[id]
  const deg = r => r * 180 / Math.PI

  // Shared experiment panel. opts: { title, lead, note, sliders, disturbance, pickDisturbance, onResult, onNext, onGainChange }
  function experiment(opts) {
    const tiltCanvas = el('canvas', 'graph'), posCanvas = el('canvas', 'graph')
    tiltCanvas.classList.add('half'); posCanvas.classList.add('half')
    const gTilt = graph(tiltCanvas, { yRange: [-40, 40], tRange: [0, 8], yLines: [-10, 10] })
    const gPos = graph(posCanvas, { yRange: [-60, 60], tRange: [0, 8], yLines: [-15, 15] })
    const graphs = el('div', 'graphs')
    graphs.append(labelled(tiltCanvas, S().graphs.tilt), labelled(posCanvas, S().graphs.position))
    const bars = metrics([{ id: 'p', label: 'P', value: '0.0' }, { id: 'd', label: 'D', value: '0.0' }, { id: 'hold', label: S().gains.khShort, value: '0.0' }, { id: 'i', label: 'I', value: '0.0' }])
    const result = el('div'), fb = el('div')
    const sliders = {}
    for (const k of opts.sliders) sliders[k] = slider({
      label: S().gains[k], min: GAIN_LIMITS[k][0], max: GAIN_LIMITS[k][1], step: 0.5, value: gains[k], id: k,
      format: v => v.toFixed(1), onInput: v => { gains[k] = v; lv.gains = { ...gains }; app.save(); opts.onGainChange?.() },
    })
    let disturbance = opts.disturbance
    const pick = el('div', 'row')
    if (opts.pickDisturbance) for (const id of EXAM) {
      const b = button(dLabel(id), () => { disturbance = id; pick.querySelectorAll('button').forEach(x => x.classList.toggle('selected', x === b)); drawBands() }, { cls: 'small', id: `dist-${id}` })
      if (id === disturbance) b.classList.add('selected')
      pick.append(b)
    }
    const runBtn = button(opts.pickDisturbance || disturbance === 'none' ? STR.common.run : `${STR.common.run} · ${dLabel(disturbance)}`, () => start(), { primary: true, id: 'run' })
    const skipBtn = button(S().skip, () => { if (play) play.speed = 40 }, { cls: 'small', id: 'skip' }); skipBtn.disabled = true
    const next = button(STR.common.next, () => opts.onNext(), { primary: true, id: 'next' }); next.hidden = true
    const spec = () => DISTURBANCES[disturbance]
    const bands = () => spec().force ? [{ t0: spec().start, t1: spec().end, color: 'rgba(248,113,113,.18)' }] : []
    const drawBands = () => { gTilt.draw([], bands()); gPos.draw([], bands()) }
    const drawUpTo = (traj, idx) => {
      const pts = traj.slice(0, idx + 1)
      gTilt.draw([{ points: pts.map(p => ({ t: p.t, y: deg(p.th) })), color: '#ffb547' }], bands())
      gPos.draw([{ points: pts.map(p => ({ t: p.t, y: p.x * 100 })), color: '#60a5fa' }], bands())
      const p = traj[idx]
      for (const k of ['p', 'd', 'hold', 'i']) bars.querySelector(`[data-id=${k}] .v`).textContent = (k === 'hold' || k === 'i' ? deg(p[k]) : p[k]).toFixed(1)
    }
    function start() {
      const run = runTrial(gains, disturbance)
      runBtn.disabled = true; skipBtn.disabled = false
      Object.values(sliders).forEach(s => s.lock(true))
      result.replaceChildren(); fb.replaceChildren()
      audio.play('click')
      play = {
        trajectory: run.trajectory, t: 0, done: false, speed: 1,
        onFrame: idx => drawUpTo(run.trajectory, idx),
        onDone: () => {
          runBtn.disabled = false; skipBtn.disabled = true
          Object.values(sliders).forEach(s => s.lock(false))
          const m = run.metrics
          result.replaceChildren(metrics([
            { id: 'stood', label: S().metrics.stood, value: m.fallen ? S().metrics.fellAt.replace('{t}', m.fellAt.toFixed(1)) : S().metrics.yes, kind: m.fallen ? 'bad' : 'good' },
            { id: 'wobble', label: S().metrics.wobble, value: `${m.wobbleDeg}°` },
            { id: 'drift', label: S().metrics.drift, value: `${m.maxErrorCm} cm` },
            { id: 'tail', label: S().metrics.tail, value: `${m.tailErrorCm} cm`, kind: m.stable ? 'good' : m.fallen ? 'bad' : '' },
          ]))
          const v = opts.onResult(m, { gains: { ...gains }, disturbance })
          if (v) { fb.append(feedback(v.text, v.kind)); popup({ text: v.text, kind: v.kind, closeLabel: STR.common.gotIt }) }
          if (v?.pass) { next.hidden = false; audio.play('pass') }
        },
      }
    }
    drawBands()
    const p = panel({ title: opts.title, lead: opts.lead, note: opts.note, body: [pick, ...Object.values(sliders), graphs, bars, result, fb], actions: [runBtn, skipBtn, next] })
    if (!opts.pickDisturbance) pick.remove()
    return p
  }
  const labelled = (canvas, text) => { const w = el('div', 'graphwrap'); w.append(el('div', 'graphlabel', text), canvas); return w }

  const steps = {
    1: () => experiment({
      title: S().steps[1].title, lead: S().steps[1].lead, note: S().steps[1].note, sliders: [], disturbance: 'none',
      onResult: m => { lv.fallNone = m.fellAt; app.save(); return { pass: true, kind: 'info', text: S().steps[1].result.replace('{t}', m.fellAt?.toFixed(1) ?? '?') } },
      onNext: () => { advance(app, 'pid', 2); go(2) },
    }),
    2: () => experiment({
      title: S().steps[2].title, lead: S().steps[2].lead, note: S().steps[2].note, sliders: ['kp'], disturbance: 'none',
      onResult: (m, run) => {
        if (run.gains.kp <= 0) return { pass: false, kind: 'bad', text: S().steps[2].needP }
        if (!m.fallen) return { pass: true, kind: 'good', text: S().steps[2].stood }
        return { pass: true, kind: 'info', text: S().steps[2].result.replace('{t}', m.fellAt.toFixed(1)).replace('{t0}', (lv.fallNone ?? 1.4).toFixed(1)) }
      },
      onNext: () => { advance(app, 'pid', 3); go(3) },
    }),
    3: () => experiment({
      title: S().steps[3].title, lead: S().steps[3].lead, note: S().steps[3].note, sliders: ['kp', 'kd'], disturbance: 'push',
      onResult: (m, run) => {
        if (run.gains.kd <= 0) return { pass: false, kind: 'bad', text: S().steps[3].needD }
        if (m.fallen) return { pass: false, kind: 'bad', text: S().steps[3].fell.replace('{t}', m.fellAt.toFixed(1)) }
        return { pass: true, kind: 'good', text: S().steps[3].result.replace('{wobble}', m.wobbleDeg).replace('{drift}', m.maxErrorCm) }
      },
      onNext: () => { advance(app, 'pid', 4); go(4) },
    }),
    4: () => experiment({
      title: S().steps[4].title, lead: S().steps[4].lead, note: S().steps[4].note, sliders: ['kp', 'kd', 'kh'], disturbance: 'push',
      onResult: (m, run) => {
        if (run.gains.kh <= 0) return { pass: false, kind: 'bad', text: S().steps[4].needH }
        if (m.fallen) return { pass: false, kind: 'bad', text: S().steps[4].fell }
        if (m.stable) return { pass: true, kind: 'good', text: S().steps[4].result.replace('{tail}', m.tailErrorCm) }
        return { pass: false, kind: 'bad', text: S().steps[4].notYet.replace('{tail}', m.tailErrorCm) }
      },
      onNext: () => { advance(app, 'pid', 5); go(5) },
    }),
    5: () => exam(),
    6: () => conceptCheck(app, 'pid', S().concept, () => go(7)),
    7: () => badgeScreen(app, 'pid', S().badge),
  }

  function exam() {
    const board = {}
    const cells = metrics(EXAM.map(id => ({ id, label: dLabel(id), value: '—' })))
    const refresh = () => {
      for (const id of EXAM) {
        const c = cells.querySelector(`[data-id=${id}]`), r = board[id]
        c.className = `metric ${r ? (r.stable ? 'good' : 'bad') : ''}`
        c.querySelector('.v').textContent = r ? (r.stable ? '✓' : r.fallen ? S().metrics.fell : `✗ ${r.tailErrorCm} cm`) : '—'
      }
    }
    const hint = el('div')
    const p = experiment({
      title: S().steps[5].title, lead: S().steps[5].lead, note: S().steps[5].note, sliders: ['kp', 'kd', 'kh', 'ki'], disturbance: 'push', pickDisturbance: true,
      onGainChange: () => { for (const k in board) delete board[k]; refresh() },
      onResult: (m, run) => {
        board[run.disturbance] = m
        refresh()
        if (EXAM.every(id => board[id]?.stable)) return { pass: true, kind: 'good', text: S().steps[5].result }
        if (!m.stable) {
          lv.examFails = (lv.examFails ?? 0) + 1; app.save()
          if (lv.examFails >= 3) hint.replaceChildren(feedback(S().steps[5].hint.replace('{kp}', REFERENCE_GAINS.kp).replace('{kd}', REFERENCE_GAINS.kd).replace('{kh}', REFERENCE_GAINS.kh).replace('{ki}', REFERENCE_GAINS.ki), 'info'))
          return { pass: false, kind: 'bad', text: (run.disturbance === 'steady_pull' && run.gains.ki <= 0 ? S().steps[5].needI : S().steps[5].failed).replace('{tail}', m.tailErrorCm) }
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
    play = null; setPose(0, 0)
    L.setStep(n)
    L.show(steps[n]())
  }
  go(lv.done ? 1 : Math.min(lv.step, 5))
  app.onLeave = cleanup
}
