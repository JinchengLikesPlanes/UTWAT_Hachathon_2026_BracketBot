// Level 2 — Teach the Rally. Real REINFORCE on a real (2-D) serve; the URDF arm plays every action.
import { STR } from '../strings.js'
import { el, button, panel, metrics, feedback, cards, choice } from '../ui.js'
import * as R from '../sim/rally.js'
import { mountLevel, advance, conceptCheck, badgeScreen } from './common.js'
import { audio } from '../audio.js'

const S = () => STR.rl
const TABLE_H = 0.76
const ARM_SWING = 1.1        // rj1: hand forward over the table edge

export async function showLevel(app) {
  const { THREE, view, robot, state } = app
  const lv = state.levels.rl
  const L = mountLevel(app, 'rl', S().title)

  // --- scene: table, net, ball, paddle ---
  const dressing = new THREE.Group()
  const wood = new THREE.MeshStandardMaterial({ color: 0xffffff, map: view.texture('tex_table.png', 2), roughness: 0.7 })
  const top = new THREE.Mesh(new THREE.BoxGeometry(R.TABLE_LEN, 0.03, 1.525), wood)
  top.position.set(R.TABLE_LEN / 2, TABLE_H - 0.015, 0); top.receiveShadow = true; top.castShadow = true
  dressing.add(top)
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xffffff })
  for (const z of [-0.7625, 0.7625]) { const m = new THREE.Mesh(new THREE.BoxGeometry(R.TABLE_LEN, 0.032, 0.02), lineMat); m.position.set(R.TABLE_LEN / 2, TABLE_H - 0.015, z); dressing.add(m) }
  for (const x of [0.15, R.TABLE_LEN - 0.15]) for (const z of [-0.6, 0.6]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, TABLE_H, 0.05), new THREE.MeshStandardMaterial({ color: 0x333a48 })); leg.position.set(x, TABLE_H / 2, z); dressing.add(leg) }
  const net = new THREE.Mesh(new THREE.BoxGeometry(0.01, R.NET_H, 1.6), new THREE.MeshStandardMaterial({ color: 0xdddddd, transparent: true, opacity: 0.8 }))
  net.position.set(R.NET_X, TABLE_H + R.NET_H / 2, 0); dressing.add(net)
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.02, 16, 12), new THREE.MeshStandardMaterial({ color: 0xff8c1a, emissive: 0x552200 }))
  ball.castShadow = true; ball.visible = false
  dressing.add(ball)
  const trailGeo = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 600 }, () => new THREE.Vector3()))
  const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xffb547, transparent: true, opacity: 0.7 }))
  trail.visible = false
  dressing.add(trail)
  view.scene.add(dressing)

  // paddle on the right hand
  const paddle = new THREE.Group()
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.012, 32), new THREE.MeshStandardMaterial({ color: 0xc0392b }))
  face.rotation.z = Math.PI / 2
  paddle.add(face)
  robot.links.get('right_eef').add(paddle)

  // --- pose helper: put the paddle centre at (x = 0, table + height) with the given loft ---
  const hand = new THREE.Vector3()
  function pose(height, tilt) {
    robot.setJoint('rj1', ARM_SWING)
    robot.setJoint('rj0', 0)
    robot.setJoint('rj5', tilt)
    robot.group.position.x = 0
    robot.group.updateMatrixWorld(true)
    robot.links.get('right_eef').getWorldPosition(hand)
    robot.setJoint('rj0', TABLE_H + height - hand.y)
    robot.group.position.x = -hand.x
    robot.group.updateMatrixWorld(true)
    robot.links.get('right_eef').getWorldPosition(hand)
    paddle.position.set(0, 0, 0)
    return hand.z
  }
  let ballZ = pose(R.HEIGHTS[2], 0)
  view.lookAt(view.phone() ? [1.4, 1.7, 5.4] : [1.9, 1.7, 5.4], view.phone() ? [1.4, 0.9, 0] : [1.9, 0.9, 0], { width: 5.2, height: 2.0 })
  const cleanup = () => { view.scene.remove(dressing); robot.links.get('right_eef').remove(paddle); robot.group.position.x = 0; app.tick = null }

  // --- ball path playback ---
  let play = null
  const setTrail = path => {
    const pos = trailGeo.attributes.position
    const n = Math.min(path.length, 600)
    for (let i = 0; i < 600; i++) { const p = path[Math.min(i, n - 1)]; pos.setXYZ(i, p.x, TABLE_H + p.y, ballZ) }
    pos.needsUpdate = true; trailGeo.setDrawRange(0, n); trail.visible = true
  }
  function playOutcome(o, action, { speed = 1, onDone } = {}) {
    ballZ = pose(action.height, action.tilt)
    trail.visible = false
    ball.visible = true
    play = { path: o.path, i: 0, speed, onDone, o, hitPlayed: false }
  }
  app.tick = dt => {
    if (trainer) trainer(dt)
    if (!play) return
    play.i += 240 * dt * play.speed
    const idx = Math.min(play.path.length - 1, Math.floor(play.i))
    const p = play.path[idx]
    ball.position.set(p.x, TABLE_H + p.y, ballZ)
    if (!play.hitPlayed && play.o.contact && p.x <= 0.01) { play.hitPlayed = true; audio.play('hit') }
    if (idx >= play.path.length - 1) { const d = play.onDone; play = null; d?.() }
  }

  // --- policy in state ---
  let policy = lv.policy ? R.Policy.fromJSON(lv.policy) : new R.Policy(0)
  let preset = lv.preset ?? 'contact'
  const savePolicy = () => { lv.policy = policy.toJSON(); lv.preset = preset; app.save() }

  // Canned demo: a serve where a miss, a touch that fails, and a legal return all exist.
  const demo = (() => {
    for (const serve of R.evalSet(777, 20)) {
      const outs = R.ACTIONS.map(a => R.simulate(serve, a))
      const miss = outs.findIndex(o => !o.contact), touch = outs.findIndex(o => o.contact && !o.legal), legal = outs.findIndex(o => o.legal)
      if (miss >= 0 && touch >= 0 && legal >= 0) return { serve, actions: [miss, touch, legal], outs: [outs[miss], outs[touch], outs[legal]] }
    }
  })()

  let trainer = null
  const steps = {
    1: () => {
      const order = [2, 0, 1]   // shown as A/B/C: legal, miss, touch — the player must find the legal one
      const fb = el('div')
      const replays = el('div', 'row')
      order.forEach((k, i) => replays.append(button(S().steps[1].replay.replace('{n}', 'ABC'[i]), () => playOutcome(demo.outs[k], R.ACTIONS[demo.actions[k]]), { id: `replay-${i}` })))
      const c = choice(order.map((k, i) => S().steps[1].options[i]), (i, b) => {
        fb.replaceChildren()
        if (order[i] === 2) { c.lock(); c.mark(i, true); fb.append(feedback(S().steps[1].correct, 'good')); audio.play('pass'); next.hidden = false }
        else { c.mark(i, false); b.disabled = true; fb.append(feedback(S().steps[1].wrong[order[i]], 'bad')); audio.play('fail') }
      })
      const next = button(STR.common.next, () => { advance(app, 'rl', 2); go(2) }, { primary: true, id: 'next' }); next.hidden = true
      return panel({ title: S().steps[1].title, lead: S().steps[1].lead, note: S().steps[1].note, body: [replays, c, fb], actions: [next] })
    },
    2: () => {
      const fb = el('div')
      const next = button(STR.common.next, () => { advance(app, 'rl', 3); go(3) }, { primary: true, id: 'next' }); next.hidden = true
      const items = S().steps[2].cards.map(c => ({ id: c.id, label: c.label }))
      const truth = Object.fromEntries(S().steps[2].cards.map(c => [c.id, c.zone]))
      const check = button(S().steps[2].check, () => {
        const wrong = items.filter(it => placement[it.id] !== truth[it.id])
        fb.replaceChildren()
        if (!wrong.length) { fb.append(feedback(S().steps[2].correct, 'good')); audio.play('pass'); next.hidden = false; check.disabled = true }
        else { fb.append(feedback(S().steps[2].wrong.replace('{n}', wrong.length), 'bad')); audio.play('fail') }
      }, { id: 'check' })
      let placement = {}
      const board = cards(items, [{ id: 'sense', title: S().steps[2].zones.sense }, { id: 'control', title: S().steps[2].zones.control }], p => { placement = p }, { moveLabel: STR.common.move })
      return panel({ title: S().steps[2].title, lead: S().steps[2].lead, note: S().steps[2].note, body: [board, fb], actions: [check, next] })
    },
    3: () => {
      const table = el('table', 'rewards')
      const head = el('tr'); head.append(el('th', '', ''), ...Object.keys(R.PRESETS).map(id => el('th', '', S().presets[id].name)))
      table.append(head)
      const outcomes = [{ contact: false, legal: false }, { contact: true, legal: false }, { contact: true, legal: true }]
      outcomes.forEach((o, i) => {
        const tr = el('tr'); tr.append(el('td', '', S().outcomes[i]))
        for (const id of Object.keys(R.PRESETS)) tr.append(el('td', 'num', `${R.rewardFor(o, id) > 0 ? '+' : ''}${R.rewardFor(o, id)}`))
        table.append(tr)
      })
      const picks = el('div', 'row')
      const next = button(STR.common.next, () => { advance(app, 'rl', 4); go(4) }, { primary: true, id: 'next' }); next.hidden = true
      const pickBtns = {}
      const blurb = el('p', 'note', '')
      const select = id => {
        preset = id; savePolicy()
        for (const [k, b] of Object.entries(pickBtns)) b.classList.toggle('selected', k === id)
        table.querySelectorAll('th, td').forEach((c, i) => { const col = i % 3; c.classList.toggle('hl', col === Object.keys(R.PRESETS).indexOf(id) + 1) })
        blurb.textContent = S().presets[id].blurb
        next.hidden = false
      }
      for (const id of Object.keys(R.PRESETS)) { pickBtns[id] = button(S().presets[id].pick, () => select(id), { id: `preset-${id}` }); picks.append(pickBtns[id]) }
      return panel({ title: S().steps[3].title, lead: S().steps[3].lead, note: S().steps[3].note, body: [table, picks, blurb], actions: [next] })
    },
    4: () => trainStep(),
    5: () => evalStep(),
    6: () => conceptCheck(app, 'rl', S().concept, () => go(7)),
    7: () => badgeScreen(app, 'rl', S().badge),
  }

  function trainStep() {
    const EP = 300, RATE = 20
    const counters = metrics([
      { id: 'ep', label: S().steps[4].m.episode, value: `${policy.episodes}` },
      { id: 'rew', label: S().steps[4].m.reward, value: '—' },
      { id: 'con', label: S().steps[4].m.contacts, value: '0' },
      { id: 'leg', label: S().steps[4].m.legal, value: '0' },
    ])
    const set = (id, v) => { counters.querySelector(`[data-id=${id}] .v`).textContent = v }
    const fb = el('div')
    const presetLine = el('p', 'note', S().steps[4].using.replace('{preset}', S().presets[preset].name))
    const next = button(STR.common.next, () => { advance(app, 'rl', 5); go(5) }, { primary: true, id: 'next' }); next.hidden = lv.step < 5 && !lv.trainedOnce
    const trainBtn = button(S().steps[4].train, () => start(), { primary: true, id: 'train' })
    const cancelBtn = button(S().steps[4].cancel, () => stop(true), { id: 'cancel' }); cancelBtn.disabled = true
    const switchBtn = button(S().steps[4].switchPreset.replace('{preset}', S().presets[preset === 'contact' ? 'return' : 'contact'].name), () => {
      preset = preset === 'contact' ? 'return' : 'contact'
      policy = new R.Policy(0); savePolicy()
      fb.replaceChildren(feedback(S().steps[4].switched.replace('{preset}', S().presets[preset].name), 'info'))
      presetLine.textContent = S().steps[4].using.replace('{preset}', S().presets[preset].name)
      switchBtn.textContent = S().steps[4].switchPreset.replace('{preset}', S().presets[preset === 'contact' ? 'return' : 'contact'].name)
      set('ep', '0'); set('rew', '—'); set('con', '0'); set('leg', '0')
    }, { id: 'switch' })
    let run = null
    function start() {
      const rng = R.rngFor(policy.episodes + 1)
      run = { n: 0, acc: 0, rewards: [], contacts: 0, legal: 0, rng }
      trainBtn.disabled = true; switchBtn.disabled = true; cancelBtn.disabled = false
      fb.replaceChildren()
      trainer = dt => {
        run.acc += dt
        while (run.acc >= 1 / RATE && run.n < EP) {
          run.acc -= 1 / RATE
          const o = R.trainEpisode(policy, run.rng, preset)
          run.n++; run.rewards.push(o.reward); if (o.contact) run.contacts++; if (o.legal) run.legal++
          const a = R.ACTIONS[o.action]
          ballZ = pose(a.height, a.tilt)
          setTrail(o.path)
          if (o.contact) audio.play('bounce')
          const last = run.rewards.slice(-20)
          set('ep', `${run.n}/${EP}`); set('rew', (last.reduce((s, v) => s + v, 0) / last.length).toFixed(1)); set('con', `${run.contacts}`); set('leg', `${run.legal}`)
        }
        if (run.n >= EP) stop(false)
      }
    }
    function stop(cancelled) {
      trainer = null
      trainBtn.disabled = false; switchBtn.disabled = false; cancelBtn.disabled = true
      savePolicy()
      if (cancelled) fb.replaceChildren(feedback(S().steps[4].cancelled.replace('{n}', run.n), 'info'))
      else {
        lv.trainedOnce = true; app.save()
        const first = run.rewards.slice(0, 50), last = run.rewards.slice(-50)
        const avg = a => a.reduce((s, v) => s + v, 0) / a.length
        fb.replaceChildren(feedback(S().steps[4].done.replace('{first}', avg(first).toFixed(1)).replace('{last}', avg(last).toFixed(1)).replace('{legal}', run.legal), avg(last) > avg(first) ? 'good' : 'info'))
        audio.play('pass'); next.hidden = false
      }
    }
    return panel({ title: S().steps[4].title, lead: S().steps[4].lead, note: S().steps[4].note, body: [presetLine, counters, fb], actions: [trainBtn, cancelBtn, switchBtn, next] })
  }

  function evalStep() {
    const fresh = new R.Policy(0)
    const board = metrics([
      { id: 'b-con', label: S().steps[5].before + ' · ' + S().steps[4].m.contacts, value: '—' },
      { id: 'b-leg', label: S().steps[5].before + ' · ' + S().steps[4].m.legal, value: '—' },
      { id: 'a-con', label: S().steps[5].after + ' · ' + S().steps[4].m.contacts, value: '—' },
      { id: 'a-leg', label: S().steps[5].after + ' · ' + S().steps[4].m.legal, value: '—' },
    ])
    const set = (id, v, kind) => { const m = board.querySelector(`[data-id=${id}]`); m.querySelector('.v').textContent = v; if (kind) m.classList.add(kind) }
    const fb = el('div')
    const next = button(STR.common.next, () => go(6), { primary: true, id: 'next' }); next.hidden = true
    const runBtn = button(S().steps[5].run, () => start(), { primary: true, id: 'run' })
    const skip = button(STR.pid.skip, () => { speed = 30 }, { cls: 'small', id: 'skip' }); skip.disabled = true
    let speed = 2
    function start() {
      runBtn.disabled = true; skip.disabled = false; fb.replaceChildren()
      const before = R.evaluate(fresh), after = R.evaluate(policy)
      const queue = [...before.outcomes.map(o => ({ o, tag: 'b' })), ...after.outcomes.map(o => ({ o, tag: 'a' }))]
      let bc = 0, bl = 0, ac = 0, al = 0
      const step = () => {
        const item = queue.shift()
        if (!item) {
          set('b-con', bc); set('b-leg', bl); set('a-con', ac, 'good'); set('a-leg', al, al > bl ? 'good' : 'bad')
          fb.replaceChildren(feedback((al > bl ? S().steps[5].improved : S().steps[5].notImproved).replace('{a}', al).replace('{b}', bl), al > bl ? 'good' : 'info'))
          lv.evaluated = { before: { contacts: bc, legal: bl }, after: { contacts: ac, legal: al } }; app.save()
          runBtn.disabled = false; skip.disabled = true; next.hidden = false; audio.play('pass')
          return
        }
        playOutcome(item.o, R.ACTIONS[item.o.action], { speed, onDone: () => {
          if (item.tag === 'b') { if (item.o.contact) bc++; if (item.o.legal) bl++; set('b-con', bc); set('b-leg', bl) }
          else { if (item.o.contact) ac++; if (item.o.legal) al++; set('a-con', ac); set('a-leg', al) }
          step()
        } })
      }
      step()
    }
    return panel({ title: S().steps[5].title, lead: S().steps[5].lead, note: S().steps[5].note, body: [board, fb], actions: [runBtn, skip, next] })
  }

  function go(n) {
    play = null; trainer = null; ball.visible = false; trail.visible = false
    ballZ = pose(R.HEIGHTS[2], 0)
    L.setStep(n)
    L.show(steps[n]())
  }
  go(lv.done ? 1 : Math.min(lv.step, 5))
  app.onLeave = cleanup
}
