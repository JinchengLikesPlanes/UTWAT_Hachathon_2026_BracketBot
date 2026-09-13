// Level 2 — Teach the Rally. Real REINFORCE on a real (2-D) serve; the URDF arm plays every action.
import { STR } from '../strings.js'
import { el, button, panel, metrics, feedback, cards, choice, graph, popup, modal } from '../ui.js'
import * as R from '../sim/rally.js'
import { mountLevel, advance, conceptCheck, badgeScreen } from './common.js'
import { audio } from '../audio.js'

const S = () => STR.rl
const TABLE_H = 0.76
const ARM_SWING = 1.1        // rj1: hand forward over the table edge
const EP = 300, RATE = 20, EVAL_EVERY = 20
const READY = { height: R.HEIGHTS[2], tilt: 0 }

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

  const paddle = new THREE.Group()
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.012, 32), new THREE.MeshStandardMaterial({ color: 0xc0392b }))
  face.rotation.z = Math.PI / 2
  paddle.add(face)
  robot.links.get('right_eef').add(paddle)

  // --- arm pose: paddle centre at (x = 0, table + height) with the given loft ---
  const hand = new THREE.Vector3()
  let armX = 0   // group offset that puts the hand on the paddle plane (computed once)
  function pose(height, tilt) {
    robot.setJoint('rj1', ARM_SWING)
    robot.setJoint('rj0', 0)
    robot.setJoint('rj5', tilt)
    robot.group.position.x = 0
    robot.group.updateMatrixWorld(true)
    robot.links.get('right_eef').getWorldPosition(hand)
    robot.setJoint('rj0', TABLE_H + height - hand.y)
    armX = -hand.x
    robot.group.position.x = armX
    robot.group.updateMatrixWorld(true)
    robot.links.get('right_eef').getWorldPosition(hand)
    return hand.z
  }
  let ballZ = pose(READY.height, READY.tilt)
  let armNow = { ...READY }
  view.lookAt(view.phone() ? [1.4, 1.7, 5.4] : [1.9, 1.7, 5.4], view.phone() ? [1.4, 0.9, 0] : [1.9, 0.9, 0], { width: 5.2, height: 2.0 })
  const cleanup = () => { view.scene.remove(dressing); robot.links.get('right_eef').remove(paddle); robot.group.position.x = 0; app.tick = null }

  // --- playback: the arm moves to its chosen pose first (so every decision is visible), then the ball flies ---
  let play = null, trainer = null
  const setTrail = path => {
    const pos = trailGeo.attributes.position
    const n = Math.min(path.length, 600)
    for (let i = 0; i < 600; i++) { const p = path[Math.min(i, n - 1)]; pos.setXYZ(i, p.x, TABLE_H + p.y, ballZ) }
    pos.needsUpdate = true; trailGeo.setDrawRange(0, n); trail.visible = true
  }
  function playOutcome(o, action, { speed = 1, moveTime = 0.4, onDone, onServe } = {}) {
    trail.visible = false; ball.visible = false
    play = { path: o.path, i: 0, speed, onDone, onServe, o, hitPlayed: false, phase: 'move', mt: 0, moveTime, from: { ...armNow }, to: action }
  }
  const idleRng = R.rngFor(42)
  let idle = { t: 0, from: { ...READY }, to: R.ACTIONS[idleRng.int(R.ACTIONS.length)], wait: 0 }
  app.tick = dt => {
    if (trainer) trainer(dt)
    if (!play && !trainer) {
      // idle: warm-up swings through the 15 paddle poses, so the robot never just stands there
      idle.t += dt
      const k = Math.min(1, idle.t / 0.8), e = k * k * (3 - 2 * k)
      armNow = { height: idle.from.height + (idle.to.height - idle.from.height) * e, tilt: idle.from.tilt + (idle.to.tilt - idle.from.tilt) * e }
      ballZ = pose(armNow.height, armNow.tilt)
      if (idle.t > 1.6) idle = { t: 0, from: { ...idle.to }, to: R.ACTIONS[idleRng.int(R.ACTIONS.length)] }
      return
    }
    if (!play) return
    if (play.phase === 'move') {
      play.mt += dt
      const k = Math.min(1, play.mt / play.moveTime), e = k * k * (3 - 2 * k)
      armNow = { height: play.from.height + (play.to.height - play.from.height) * e, tilt: play.from.tilt + (play.to.tilt - play.from.tilt) * e }
      ballZ = pose(armNow.height, armNow.tilt)
      if (k >= 1) { play.phase = 'fly'; ball.visible = true; play.onServe?.() }
      return
    }
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
  lv.explore ??= null
  lv.curve ??= []
  const savePolicy = () => { lv.policy = policy.toJSON(); lv.preset = preset; app.save() }
  const resetPolicy = () => { policy = new R.Policy(0); lv.curve = []; lv.trainedOnce = false; lv.moreOnce = false; savePolicy() }
  const sampleServe = R.evalSet(777, 1)[0]

  // Probability bars: how sure the robot is about each of its 15 choices for one serve.
  function probBars() {
    const c = el('canvas', 'graph'); c.classList.add('probs')
    const wrap = el('div', 'graphwrap'); wrap.append(el('div', 'graphlabel', S().uncertainty.barsLabel), c)
    wrap.draw = () => {
      const ctx = c.getContext('2d'), dpr = Math.min(devicePixelRatio || 1, 2), w = c.clientWidth, h = c.clientHeight
      if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h)
      const p = policy.probs(sampleServe), n = p.length, bw = w / n
      p.forEach((v, i) => { ctx.fillStyle = i === policy.greedy(sampleServe) ? '#ffb547' : '#3b4a6b'; ctx.fillRect(i * bw + 2, h - v * (h - 4), bw - 4, v * (h - 4)) })
      ctx.strokeStyle = '#4a5670'; ctx.beginPath(); ctx.moveTo(0, h - (1 / n) * (h - 4)); ctx.lineTo(w, h - (1 / n) * (h - 4)); ctx.stroke()
      wrap.maxP = Math.max(...p)
    }
    requestAnimationFrame(wrap.draw)
    return wrap
  }

  // Canned demo: a serve where a miss, a touch that fails, and a legal return all exist.
  const demo = (() => {
    for (const serve of R.evalSet(777, 20)) {
      const outs = R.ACTIONS.map(a => R.simulate(serve, a))
      const miss = outs.findIndex(o => !o.contact), touch = outs.findIndex(o => o.contact && !o.legal), legal = outs.findIndex(o => o.legal)
      if (miss >= 0 && touch >= 0 && legal >= 0) return { serve, actions: [miss, touch, legal], outs: [outs[miss], outs[touch], outs[legal]] }
    }
  })()

  const teach = (text, kind, onClose) => popup({ text, kind, closeLabel: STR.common.gotIt, onClose })

  const steps = {
    1: () => {
      const order = [2, 0, 1]   // shown as A/B/C: legal, miss, touch
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
      let placement = {}
      const check = button(S().steps[2].check, () => {
        const wrong = items.filter(it => placement[it.id] !== truth[it.id])
        fb.replaceChildren()
        if (!wrong.length) { fb.append(feedback(S().steps[2].correct, 'good')); audio.play('pass'); next.hidden = false; check.disabled = true }
        else { fb.append(feedback(S().steps[2].wrong.replace('{n}', wrong.length), 'bad')); audio.play('fail') }
      }, { id: 'check' })
      const board = cards(items, [{ id: 'sense', title: S().steps[2].zones.sense }, { id: 'control', title: S().steps[2].zones.control }], p => { placement = p }, { moveLabel: STR.common.move })
      return panel({ title: S().steps[2].title, lead: S().steps[2].lead, note: S().steps[2].note, body: [board, fb], actions: [check, next], focus: true })
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
        if (preset !== id) resetPolicy()
        preset = id; savePolicy()
        for (const [k, b] of Object.entries(pickBtns)) b.classList.toggle('selected', k === id)
        table.querySelectorAll('th, td').forEach((c, i) => { c.classList.toggle('hl', i % 3 === Object.keys(R.PRESETS).indexOf(id) + 1) })
        blurb.textContent = S().presets[id].blurb
        next.hidden = false
      }
      for (const id of Object.keys(R.PRESETS)) { pickBtns[id] = button(S().presets[id].pick, () => select(id), { id: `preset-${id}` }); picks.append(pickBtns[id]) }
      return panel({ title: S().steps[3].title, lead: S().steps[3].lead, note: S().steps[3].note, body: [table, picks, blurb], actions: [next], focus: true })
    },
    4: () => {
      const bars = probBars()
      const fb = el('div')
      const next = button(STR.common.next, () => { advance(app, 'rl', 5); go(5) }, { primary: true, id: 'next' }); next.hidden = lv.explore === null
      const btns = {}
      const pick = v => {
        if (lv.explore !== null && lv.explore !== v) { resetPolicy(); bars.draw() }
        lv.explore = v; app.save()
        btns.yes.classList.toggle('selected', v); btns.no.classList.toggle('selected', !v)
        fb.replaceChildren(feedback(v ? S().uncertainty.yesText : S().uncertainty.noText, v ? 'good' : 'info'))
        next.hidden = false
      }
      btns.yes = button(S().uncertainty.yes, () => pick(true), { id: 'explore-yes' })
      btns.no = button(S().uncertainty.no, () => pick(false), { id: 'explore-no' })
      if (lv.explore !== null) { btns.yes.classList.toggle('selected', lv.explore); btns.no.classList.toggle('selected', !lv.explore) }
      const row = el('div', 'row'); row.append(btns.yes, btns.no)
      return panel({ title: S().uncertainty.title, lead: S().uncertainty.lead, note: S().uncertainty.note, body: [bars, row, fb], actions: [next], focus: true })
    },
    5: () => trainStep({ more: false }),
    6: () => enoughStep(),
    7: () => evalStep(),
    8: () => conceptCheck(app, 'rl', S().concept, () => go(9)),
    9: () => {
      const p = badgeScreen(app, 'rl', S().badge)
      p.actionsEl.prepend(button(S().realGame.button, () => showRealGame(), { id: 'real-game' }))
      return p
    },
  }

  // Runs `episodes` training serves at RATE/s with the arm animating; calls onDone(run) when finished.
  function makeTrainer({ episodes, counters, onDone }) {
    const set = (id, v) => { counters.querySelector(`[data-id=${id}] .v`).textContent = v }
    const rng = R.rngFor(policy.episodes + 1)
    const run = { n: 0, acc: 0, rewards: [], contacts: 0, legal: 0, evals: [] }
    if (!lv.curve.length) lv.curve.push({ episodes: 0, legal: R.evaluate(policy).legal })
    trainer = dt => {
      run.acc += dt
      while (run.acc >= 1 / RATE && run.n < episodes) {
        run.acc -= 1 / RATE
        const o = R.trainEpisode(policy, rng, preset, R.LR, lv.explore !== false)
        run.n++; run.rewards.push(o.reward); if (o.contact) run.contacts++; if (o.legal) run.legal++
        const a = R.ACTIONS[o.action]
        armNow = { ...a }; ballZ = pose(a.height, a.tilt)
        setTrail(o.path)
        if (o.contact) audio.play('bounce')
        if (policy.episodes % EVAL_EVERY === 0) { const e = R.evaluate(policy).legal; lv.curve.push({ episodes: policy.episodes, legal: e }); run.evals.push(e) }
        const last = run.rewards.slice(-20)
        set('ep', `${run.n}/${episodes}`); set('rew', (last.reduce((s, v) => s + v, 0) / last.length).toFixed(1)); set('con', `${run.contacts}`); set('leg', `${run.legal}`)
        counters.onEpisode?.()
      }
      if (run.n >= episodes) { trainer = null; savePolicy(); onDone(run) }
    }
    return { stop: () => { trainer = null; savePolicy(); return run } }
  }
  const counterBox = () => metrics([
    { id: 'ep', label: S().steps[5].m.episode, value: `${policy.episodes}` },
    { id: 'rew', label: S().steps[5].m.reward, value: '—' },
    { id: 'con', label: S().steps[5].m.contacts, value: '0' },
    { id: 'leg', label: S().steps[5].m.legal, value: '0' },
  ])

  function trainStep() {
    const counters = counterBox()
    const bars = probBars()
    counters.onEpisode = () => { if (policy.episodes % 5 === 0) bars.draw() }
    const fb = el('div')
    const presetLine = el('p', 'note', S().steps[5].using.replace('{preset}', S().presets[preset].name).replace('{explore}', lv.explore === false ? S().uncertainty.noShort : S().uncertainty.yesShort))
    const next = button(STR.common.next, () => { advance(app, 'rl', 6); go(6) }, { primary: true, id: 'next' }); next.hidden = !lv.trainedOnce
    const backBtn = button(S().steps[5].backToExplore, () => go(4), { id: 'to-explore' }); backBtn.hidden = true
    const trainBtn = button(S().steps[5].train, () => start(), { primary: true, id: 'train' })
    const cancelBtn = button(S().steps[5].cancel, () => { const run = handle.stop(); done(run, true) }, { id: 'cancel' }); cancelBtn.disabled = true
    const switchBtn = button(S().steps[5].switchPreset.replace('{preset}', S().presets[preset === 'contact' ? 'return' : 'contact'].name), () => {
      preset = preset === 'contact' ? 'return' : 'contact'
      resetPolicy()
      fb.replaceChildren(feedback(S().steps[5].switched.replace('{preset}', S().presets[preset].name), 'info'))
      presetLine.textContent = S().steps[5].using.replace('{preset}', S().presets[preset].name).replace('{explore}', lv.explore === false ? S().uncertainty.noShort : S().uncertainty.yesShort)
      switchBtn.textContent = S().steps[5].switchPreset.replace('{preset}', S().presets[preset === 'contact' ? 'return' : 'contact'].name)
      counters.querySelector('[data-id=ep] .v').textContent = '0'; bars.draw()
    }, { id: 'switch' })
    let handle = null
    function start() {
      trainBtn.disabled = true; switchBtn.disabled = true; cancelBtn.disabled = false; fb.replaceChildren()
      handle = makeTrainer({ episodes: EP, counters, onDone: run => done(run, false) })
    }
    function done(run, cancelled) {
      trainBtn.disabled = false; switchBtn.disabled = false; cancelBtn.disabled = true
      bars.draw()
      if (cancelled) { fb.replaceChildren(feedback(S().steps[5].cancelled.replace('{n}', run.n), 'info')); return }
      lv.trainedOnce = true; app.save()
      const avg = a => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length)
      const first = avg(run.rewards.slice(0, 50)), last = avg(run.rewards.slice(-50))
      const evalNow = R.evaluate(policy).legal
      let text, kind, pop
      const sure = Math.round(bars.maxP * 100)
      if (lv.explore === false && evalNow <= 6) { text = S().steps[5].noExplore.replace('{legal}', run.legal); pop = S().steps[5].noExplorePop; kind = 'bad'; backBtn.hidden = false }
      else { text = S().steps[5].done.replace('{first}', first.toFixed(1)).replace('{last}', last.toFixed(1)).replace('{legal}', run.legal).replace('{sure}', sure); pop = S().steps[5].pop.replace('{legal}', run.legal).replace('{sure}', sure); kind = last > first ? 'good' : 'info'; next.hidden = false }
      fb.replaceChildren(feedback(text, kind))
      audio.play(kind === 'bad' ? 'fail' : 'pass')
      teach(pop, kind)
    }
    return panel({ title: S().steps[5].title, lead: S().steps[5].lead, note: S().steps[5].note, body: [presetLine, counters, bars, fb], actions: [trainBtn, cancelBtn, switchBtn, backBtn, next] })
  }

  // Step 6: is 300 enough? The learning curve (legal returns on the 20 unseen serves vs serves trained) + train more.
  function enoughStep() {
    const canvas = el('canvas', 'graph')
    const wrap = el('div', 'graphwrap'); wrap.append(el('div', 'graphlabel', S().enough.curveLabel), canvas)
    const g = graph(canvas, { yRange: [0, 20], tRange: [0, Math.max(600, ...lv.curve.map(c => c.episodes)) + 50], yLines: [5, 10, 15] })
    const draw = () => g.draw([{ points: lv.curve.map(c => ({ t: c.episodes, y: c.legal })), color: '#4ade80', width: 3 }], [{ t0: 300, t1: 301, color: '#ffb547' }])
    requestAnimationFrame(draw)
    const counters = counterBox()
    counters.onEpisode = draw
    const fb = el('div')
    const plateau = () => {
      const c = lv.curve; if (c.length < 4) return null
      const at = n => c.filter(p => p.episodes <= n).at(-1)?.legal ?? 0
      const now = c.at(-1).legal
      const flatAt = c.find(p => p.legal >= now - 1)?.episodes ?? c.at(-1).episodes
      return { at100: at(100), at300: at(300), now, total: c.at(-1).episodes, flatAt }
    }
    const explain = () => {
      const p = plateau(); if (!p) return
      const msg = S().enough.summary.replace('{at100}', p.at100).replace('{at300}', p.at300).replace('{now}', p.now).replace('{total}', p.total)
      return msg
    }
    const initial = el('p', 'note', explain() ?? '')
    const next = button(STR.common.next, () => { advance(app, 'rl', 7); go(7) }, { primary: true, id: 'next' }); next.hidden = !lv.moreOnce
    const moreBtn = button(S().enough.more, () => {
      moreBtn.disabled = true; fb.replaceChildren()
      g.opts = null
      makeTrainer({ episodes: EP, counters, onDone: run => {
        moreBtn.disabled = false; lv.moreOnce = true; app.save(); draw()
        const p = plateau()
        const gain = p.now - p.at300
        const text = (gain >= 3 ? S().enough.stillRising : S().enough.flat).replace('{gain}', gain).replace('{now}', p.now).replace('{at300}', p.at300).replace('{total}', p.total).replace('{flatAt}', p.flatAt)
        fb.replaceChildren(feedback(text, 'good')); audio.play('pass'); next.hidden = false
        teach((gain >= 3 ? S().enough.stillRisingPop : S().enough.flatPop).replace('{flatAt}', p.flatAt).replace('{at300}', p.at300).replace('{now}', p.now), 'good')
      } })
    }, { primary: true, id: 'more' })
    return panel({ title: S().enough.title, lead: S().enough.lead, note: S().enough.note, body: [wrap, initial, counters, fb], actions: [moreBtn, next] })
  }

  function evalStep() {
    const fresh = new R.Policy(0)
    const board = metrics([
      { id: 'b-con', label: S().steps[7].before + ' · ' + S().steps[5].m.contacts, value: '—' },
      { id: 'b-leg', label: S().steps[7].before + ' · ' + S().steps[5].m.legal, value: '—' },
      { id: 'a-con', label: S().steps[7].after + ' · ' + S().steps[5].m.contacts, value: '—' },
      { id: 'a-leg', label: S().steps[7].after + ' · ' + S().steps[5].m.legal, value: '—' },
    ])
    const set = (id, v, kind) => { const m = board.querySelector(`[data-id=${id}]`); m.querySelector('.v').textContent = v; if (kind) m.classList.add(kind) }
    const status = el('div', 'feedback info', S().steps[7].idle)
    const fb = el('div')
    const next = button(STR.common.next, () => go(8), { primary: true, id: 'next' }); next.hidden = true
    const runBtn = button(S().steps[7].run, () => start(), { primary: true, id: 'run' })
    const skip = button(STR.pid.skip, () => { speed = 30; moveTime = 0.05 }, { cls: 'small', id: 'skip' }); skip.disabled = true
    let speed = 1.6, moveTime = 0.4
    function start() {
      runBtn.disabled = true; skip.disabled = false; fb.replaceChildren()
      const before = R.evaluate(fresh), after = R.evaluate(policy)
      const queue = [...before.outcomes.map((o, i) => ({ o, i, tag: 'b' })), ...after.outcomes.map((o, i) => ({ o, i, tag: 'a' }))]
      let bc = 0, bl = 0, ac = 0, al = 0
      const step = () => {
        const item = queue.shift()
        if (!item) {
          set('b-con', bc); set('b-leg', bl); set('a-con', ac, 'good'); set('a-leg', al, al > bl ? 'good' : 'bad')
          const text = (al > bl ? S().steps[7].improved : S().steps[7].notImproved).replace('{a}', al).replace('{b}', bl)
          fb.replaceChildren(feedback(text, al > bl ? 'good' : 'info'))
          status.textContent = S().steps[7].idle
          lv.evaluated = { before: { contacts: bc, legal: bl }, after: { contacts: ac, legal: al } }; app.save()
          runBtn.disabled = false; skip.disabled = true; next.hidden = false; audio.play('pass')
          teach(S().steps[7].pop.replace('{b}', bl).replace('{a}', al), al > bl ? 'good' : 'info')
          return
        }
        const a = R.ACTIONS[item.o.action]
        status.textContent = S().steps[7].serving.replace('{n}', item.i + 1).replace('{who}', item.tag === 'b' ? S().steps[7].before : S().steps[7].after)
          .replace('{height}', Math.round(a.height * 100)).replace('{tilt}', S().tilts[R.TILTS.indexOf(a.tilt)])
        playOutcome(item.o, a, { speed, moveTime, onDone: () => {
          if (item.tag === 'b') { if (item.o.contact) bc++; if (item.o.legal) bl++; set('b-con', bc); set('b-leg', bl) }
          else { if (item.o.contact) ac++; if (item.o.legal) al++; set('a-con', ac); set('a-leg', al) }
          // back to the ready pose between serves so the next decision is visible
          play = { path: [{ x: 3, y: -1 }], i: 0, speed: 1, o: { contact: false }, phase: 'move', mt: 0, moveTime: moveTime * 0.6, from: { ...armNow }, to: READY, onDone: step }
        } })
      }
      step()
    }
    return panel({ title: S().steps[7].title, lead: S().steps[7].lead, note: S().steps[7].note, body: [status, board, fb], actions: [runBtn, skip, next] })
  }

  function showRealGame() {
    const r = S().realGame
    const status = el('div')
    const startBtn = button(r.start, async () => {
      startBtn.disabled = true
      status.replaceChildren(feedback(r.starting, 'info'))
      try {
        const res = await fetch('./launch', { method: 'POST' })
        const j = await res.json().catch(() => ({}))
        if (res.ok) { status.replaceChildren(feedback(j.started ? r.started : r.alreadyRunning, 'good')); audio.play('pass') }
        else status.replaceChildren(feedback(r.failed.replace('{why}', j.error ?? res.status), 'bad'))
      } catch { status.replaceChildren(feedback(r.noLauncher, 'bad')) }
      startBtn.disabled = false
    }, { primary: true, id: 'start-real-game' })
    const m = modal({ title: r.title, lines: [r.intro, r.steps, r.outro], warn: r.warn, actions: [startBtn, button(STR.common.close, () => m.remove(), { id: 'close-real-game' })] })
    const pre = el('pre', 'cmd', r.commands.join('\n'))
    const box = m.querySelector('.box')
    box.insertBefore(pre, box.querySelector('.row'))
    box.insertBefore(status, box.querySelector('.row'))
    m.dataset.modal = 'real-game'
    app.ui.append(m)
  }

  function go(n) {
    play = null; trainer = null; ball.visible = false; trail.visible = false
    armNow = { ...READY }; ballZ = pose(READY.height, READY.tilt)
    L.setStep(n)
    L.show(steps[n]())
  }
  go(lv.done ? 1 : Math.min(lv.step, 7))
  app.onLeave = cleanup
}
