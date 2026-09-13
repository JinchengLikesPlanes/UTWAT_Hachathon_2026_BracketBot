// Level 2 — See the Ball. The head depth camera watches real serves; the player builds the tracking
// pipeline setting by setting (colour width → depth → frame gap + bounce rule) and passes an exam.
// Everything shown in the two camera views is exactly what sim/vision.js analysed.
import { STR } from '../strings.js'
import { el, button, panel, metrics, feedback, choice, graph, popup } from '../ui.js'
import * as V from '../sim/vision.js'
import { makeSpinner } from '../robot.js'
import { mountLevel, advance, conceptCheck, badgeScreen } from './common.js'
import { audio } from '../audio.js'
import { buildTable, TABLE_H } from './table.js'

const S = () => STR.vision
const CAM_OFFSET_X = 0.055          // camera cover centre, forward of the robot origin (measured from the URDF meshes)
const HEAD = 'head__head__head__head'
const TEACH_SERVE = 1, GAP_SERVE = 28   // serves whose numbers make each lesson visible
const PLAY_SPEED = 0.4              // playback slow-down so 30 fps frames can be watched

export async function showLevel(app) {
  const { THREE, view, robot, state } = app
  const lv = state.levels.vision
  lv.width ??= 30; lv.mode ??= null; lv.gap ??= 1; lv.bounceRule ??= false
  const L = mountLevel(app, 'vision', S().title)

  // --- scene: table, ball, forecast marker, camera frustum from the head ---
  const dressing = new THREE.Group()
  dressing.add(buildTable(THREE, view))
  const ball = new THREE.Mesh(new THREE.SphereGeometry(V.BALL_R, 16, 12), new THREE.MeshStandardMaterial({ color: 0xff8c1a, emissive: 0x552200 }))
  ball.castShadow = true; ball.visible = false
  const marker = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, 0.3), new THREE.MeshBasicMaterial({ color: 0xffb547 }))
  marker.visible = false
  const truthRing = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.006, 8, 24), new THREE.MeshBasicMaterial({ color: 0x4ade80 }))
  truthRing.rotation.y = Math.PI / 2; truthRing.visible = false
  // frustum: camera eye to the four image corners at 1 m
  const cy = TABLE_H + V.CAM.y, cp = Math.cos(V.CAM.pitch), sp = Math.sin(V.CAM.pitch)
  const corner = (a, b) => new THREE.Vector3(V.CAM.x + (cp + b * sp), cy + (-sp + b * cp), a)
  const ha = (V.CAM.W / 2) / V.F, hb = (V.CAM.H / 2) / V.F
  const eye = new THREE.Vector3(V.CAM.x, cy, 0)
  const cs = [corner(-ha, hb), corner(ha, hb), corner(ha, -hb), corner(-ha, -hb)]
  const pts = []
  for (let i = 0; i < 4; i++) pts.push(eye, cs[i], cs[i], cs[(i + 1) % 4])
  const frustum = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.5 }))
  dressing.add(ball, marker, truthRing, frustum)
  view.scene.add(dressing)

  // the robot stands so the camera cover is exactly where the sim's camera is; the head nods down by the sim's pitch
  robot.group.position.set(V.CAM.x - CAM_OFFSET_X, 0, 0)
  const head = makeSpinner(robot, HEAD, undefined, false)
  view.lookAt(view.phone() ? [1.0, 1.9, 4.6] : [1.3, 1.9, 4.4], view.phone() ? [1.0, 1.0, 0] : [1.2, 1.0, 0], { width: 4.6, height: 2.2 })

  // --- camera views in the panel: colour (+ detection mask) and depth ---
  const { W, H } = V.CAM
  function views({ mask = true } = {}) {
    const root = el('div', 'camviews')
    const mk = label => { const w = el('div', 'camview'); const c = el('canvas'); c.width = W; c.height = H; w.append(c, el('div', 'graphlabel', label)); root.append(w); return c }
    const cc = mk(S().views.colour), dc = mk(S().views.depth)
    const img = new ImageData(W, H), dimg = new ImageData(W, H)
    root.show = fr => {
      if (!fr) { for (const c of [cc, dc]) c.getContext('2d').clearRect(0, 0, W, H); return }
      img.data.set(fr.rgb)
      if (mask && fr.mask) for (let i = 0; i < W * H; i++) if (fr.mask[i]) { img.data[i * 4] = 60; img.data[i * 4 + 1] = 240; img.data[i * 4 + 2] = 120 }
      const ctx = cc.getContext('2d'); ctx.putImageData(img, 0, 0)
      if (mask && fr.found) { ctx.strokeStyle = '#ffb547'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(fr.u - 4, fr.v + 0.5); ctx.lineTo(fr.u + 5, fr.v + 0.5); ctx.moveTo(fr.u + 0.5, fr.v - 4); ctx.lineTo(fr.u + 0.5, fr.v + 5); ctx.stroke() }
      for (let i = 0; i < W * H; i++) { const g = Math.max(0, Math.min(255, 255 * (1 - (fr.depth[i] - 0.3) / 3.7))); dimg.data[i * 4] = dimg.data[i * 4 + 1] = dimg.data[i * 4 + 2] = g; dimg.data[i * 4 + 3] = 255 }
      dc.getContext('2d').putImageData(dimg, 0, 0)
    }
    return root
  }
  function readout() {
    const m = metrics(['x', 'y', 'vx', 'vy', 'pred'].map(k => ({ id: `ro-${k}`, label: S().readout[k], value: S().readout.none })))
    m.classList.add('readout')
    const cells = Object.fromEntries(['x', 'y', 'vx', 'vy', 'pred'].map(k => [k, m.querySelector(`[data-id=ro-${k}] .v`)]))
    m.show = fr => {
      const f = (v, d = 2) => v === undefined ? S().readout.none : v.toFixed(d)
      cells.x.textContent = f(fr?.x); cells.y.textContent = f(fr?.y); cells.vx.textContent = f(fr?.vx, 1); cells.vy.textContent = f(fr?.vy, 1)
      cells.pred.textContent = fr?.pred === undefined ? S().readout.none : (fr.pred * 100).toFixed(0)
    }
    return m
  }

  // --- playback of a tracked serve ---
  let play = null, idleT = 0
  app.tick = dt => {
    idleT += dt
    if (!play) { head.setAngle(V.CAM.pitch + 0.04 * Math.sin(idleT * 0.8)); robot.setJoint('rj1', 0.1 + 0.04 * Math.sin(idleT * 1.1)); robot.setJoint('lj1', 0.1 + 0.04 * Math.sin(idleT * 1.1 + 2)); return }
    head.setAngle(V.CAM.pitch)
    play.t += dt * play.speed
    const k = Math.min(play.r.frames.length - 1, Math.floor(play.t * V.CAM.fps))
    if (k !== play.k) {
      play.k = k
      const fr = play.r.frames[k]
      ball.position.set(fr.truth.x, TABLE_H + fr.truth.y, 0); ball.visible = true
      if (fr.pred !== undefined) { marker.position.set(0, TABLE_H + fr.pred, 0); marker.visible = true }
      play.onFrame?.(fr, k)
    }
    if (play.t >= play.r.crossT) {
      ball.position.set(0, TABLE_H + play.r.crossY, 0)
      truthRing.position.set(0, TABLE_H + play.r.crossY, 0); truthRing.visible = play.showTruth
      const d = play.onDone; play = null; d?.()
    }
  }
  function playTrack(r, { speed = PLAY_SPEED, onFrame, onDone, showTruth = true } = {}) {
    marker.visible = false; truthRing.visible = false; ball.visible = false
    play = { r, t: 0, k: -1, speed, onFrame, onDone, showTruth }
  }
  const runServe = (n, opts) => V.track(V.serveFor(n), { ...opts, keepFrames: true }, V.rngFor(n))
  const cleanup = () => { view.scene.remove(dressing); head.setAngle(0); robot.group.position.set(0, 0, 0); app.tick = null }
  const teach = (text, kind, onClose) => popup({ text, kind, closeLabel: STR.common.gotIt, onClose })
  const pct = v => Math.round(v * 100), cm = v => (v * 100).toFixed(1)

  // A step that serves one ball, shows the camera views live, and judges the result.
  function serveStep(n, cfg) {
    const vw = views({ mask: cfg.mask ?? true }), ro = readout(), fb = el('div'), stats = el('div')
    ro.hidden = cfg.readout === false
    const next = button(STR.common.next, cfg.onNext, { primary: true, id: 'next' }); next.hidden = !cfg.passed()
    const serve = button(S().serve, () => {
      if (play) return
      const opts = cfg.opts()
      if (!opts) return
      serve.disabled = true; fb.replaceChildren(); stats.replaceChildren(); ro.show(null)
      const r = runServe(n, opts)
      audio.play('click')
      playTrack(r, {
        onFrame: fr => { vw.show(fr); ro.show(fr); cfg.onFrame?.(fr) },
        onDone: () => {
          serve.disabled = false
          ro.show(r.decision)   // the four numbers at the decision moment — what the pong brain reads
          const v = cfg.verdict(r)
          stats.replaceChildren(cfg.stats(r))
          fb.replaceChildren(feedback(v.text, v.pass ? 'good' : 'bad'))
          audio.play(v.pass ? 'pass' : 'fail')
          if (v.pass) { cfg.onPass?.(r); next.hidden = !cfg.passed() }
          teach(v.text, v.pass ? 'good' : 'bad')
        },
      })
    }, { primary: true, id: 'serve' })
    const body = [vw, ...(cfg.controls ?? []), ro, stats, fb]
    const p = panel({ title: cfg.title, lead: cfg.lead, note: cfg.note, body, actions: [serve, next] })
    p.views = vw
    return p
  }

  // Button group that stores a setting in level state.
  function picker(items, get, set, idPrefix) {
    const row = el('div', 'row picks')
    const btns = items.map(it => button(it.label, () => { set(it.value); refresh() }, { id: `${idPrefix}-${it.value}`, cls: 'small' }))
    const refresh = () => btns.forEach((b, i) => b.classList.toggle('selected', items[i].value === get()))
    refresh(); row.append(...btns)
    return row
  }

  const steps = {
    1: () => {
      const q = el('div'), qc = el('div')
      const p = serveStep(TEACH_SERVE, {
        title: S().steps[1].title, lead: S().steps[1].lead, note: S().steps[1].note, mask: false, readout: false,
        opts: () => ({ width: 10, mode: 'depth', gap: 3, bounceRule: true }),
        stats: () => el('div'),
        verdict: () => ({ pass: true, text: S().pop.twoPictures }),
        onPass: () => {
          if (q.children.length) return
          // the question appears after the first serve; Next waits for the right answer
          q.append(el('p', 'lead', S().steps[1].question))
          const c = choice(S().steps[1].options, (i, b) => {
            qc.replaceChildren()
            if (i === S().steps[1].answer) { c.lock(); c.mark(i, true); qc.append(feedback(S().steps[1].correct, 'good')); audio.play('pass'); lv.sawCamera = true; app.save(); p.querySelector('[data-id=next]').hidden = false }
            else { c.mark(i, false); b.disabled = true; qc.append(feedback(STR.common.wrong, 'bad')); audio.play('fail') }
          }, { idPrefix: 'which' })
          q.append(c, qc)
        },
        passed: () => !!lv.sawCamera,
        onNext: () => { advance(app, 'vision', 2); go(2) },
      })
      p.insertBefore(q, p.actionsEl)
      return p
    },
    2: () => serveStep(TEACH_SERVE, {
      title: S().steps[2].title, lead: S().steps[2].lead, note: S().steps[2].note,
      controls: [picker(V.HUE_WIDTHS.map(w => ({ value: w, label: S().widths[w] })), () => lv.width, w => { lv.width = w; app.save() }, 'width')],
      opts: () => ({ width: lv.width, mode: 'depth', gap: 3, bounceRule: true }),
      stats: r => metrics([{ id: 'found', label: S().metrics.found, value: `${pct(r.foundRate)}%`, kind: r.foundRate >= 0.9 ? 'good' : 'bad' }, { id: 'px', label: S().metrics.px, value: `${r.pxErr?.toFixed(1) ?? '—'} px`, kind: r.pxErr < 1 ? 'good' : 'bad' }]),
      verdict: r => {
        if (r.pxErr > 1) return { pass: false, text: S().pop.table.replace('{px}', r.pxErr.toFixed(0)) }
        if (r.foundRate < 0.9) return { pass: false, text: S().pop.lost.replace('{miss}', pct(1 - r.foundRate)) }
        return { pass: true, text: S().pop.found.replace('{found}', pct(r.foundRate)).replace('{px}', r.pxErr.toFixed(1)) }
      },
      onPass: () => { lv.widthOk = true; app.save() }, passed: () => !!lv.widthOk,
      onNext: () => { advance(app, 'vision', 3); go(3) },
    }),
    3: () => serveStep(TEACH_SERVE, {
      title: S().steps[3].title, lead: S().steps[3].lead, note: S().steps[3].note,
      controls: [picker(['size', 'depth'].map(m => ({ value: m, label: S().modes[m] })), () => lv.mode, m => { lv.mode = m; app.save() }, 'mode')],
      opts: () => lv.mode ? { width: lv.width, mode: lv.mode, gap: 3, bounceRule: true } : null,
      stats: r => metrics([{ id: 'pos', label: S().metrics.pos, value: `${cm(r.posErr)} cm`, kind: r.posErr <= 0.03 ? 'good' : 'bad' }]),
      verdict: r => lv.mode === 'depth' && r.posErr <= 0.03 ? { pass: true, text: S().pop.depth.replace('{err}', cm(r.posErr)) } : { pass: false, text: S().pop.size.replace('{err}', cm(r.posErr)) },
      onPass: () => { lv.depthOk = true; app.save() }, passed: () => !!lv.depthOk,
      onNext: () => { advance(app, 'vision', 4); go(4) },
    }),
    4: () => {
      const gc = el('canvas', 'graph'); gc.classList.add('half')
      const gw = el('div', 'graphwrap'); gw.append(el('div', 'graphlabel', S().graph), gc)
      const g = graph(gc, { yRange: [0, 60], tRange: [0, 1.0], yLines: [20, 40] })
      let pts = []
      const crossY = V.flight(V.serveFor(GAP_SERVE)).crossY * 100
      const bounceBtn = button('', () => { lv.bounceRule = !lv.bounceRule; app.save(); bounceBtn.textContent = S().bounce[lv.bounceRule ? 'on' : 'off']; bounceBtn.classList.toggle('selected', lv.bounceRule) }, { id: 'bounce', cls: 'small' })
      bounceBtn.textContent = S().bounce[lv.bounceRule ? 'on' : 'off']; bounceBtn.classList.toggle('selected', lv.bounceRule)
      const gapRow = picker(V.GAPS.map(n => ({ value: n, label: S().gaps[n] })), () => lv.gap, n => { lv.gap = n; app.save() }, 'gap')
      gapRow.append(bounceBtn)
      const p = serveStep(GAP_SERVE, {
        title: S().steps[4].title, lead: S().steps[4].lead, note: S().steps[4].note,
        controls: [gapRow, gw],
        opts: () => { pts = []; g.draw([]); return { width: lv.width, mode: 'depth', gap: lv.gap, bounceRule: lv.bounceRule } },
        onFrame: fr => { if (fr.pred !== undefined) pts.push({ t: fr.t, y: fr.pred * 100 }); g.draw([{ points: [{ t: 0, y: crossY }, { t: 1, y: crossY }], color: '#4ade80', width: 1 }, { points: pts, color: '#ffb547' }]) },
        stats: r => metrics([
          { id: 'pred', label: S().metrics.pred, value: r.decision ? `${cm(r.decision.err)} cm` : '—', kind: r.hit ? 'good' : 'bad' },
          { id: 'when', label: S().metrics.when, value: r.decision ? S().metrics.early.replace('{t}', (r.crossT - r.decision.t).toFixed(2)) : S().metrics.late, kind: r.decision ? 'good' : 'bad' },
          { id: 'vel', label: S().metrics.vel, value: r.velErr === null ? '—' : `${r.velErr.toFixed(2)} m/s` },
        ]),
        verdict: r => {
          if (!r.decision) return { pass: false, text: S().pop.late }
          if (r.hit) return { pass: true, text: S().pop.good.replace('{err}', cm(r.decision.err)).replace('{t}', (r.crossT - r.decision.t).toFixed(2)) }
          const straddled = r.frames[r.decision.k]?.bounceInWindow
          return { pass: false, text: (straddled || !lv.bounceRule ? S().pop.bounce : S().pop.noisy).replace('{err}', cm(r.decision.err)) }
        },
        onPass: () => { lv.gapOk = true; app.save() }, passed: () => !!lv.gapOk,
        onNext: () => { advance(app, 'vision', 5); go(5) },
      })
      return p
    },
    5: () => {
      const vw = views(), ro = readout(), status = el('div', 'note'), fb = el('div'), list = el('div', 'examlist')
      const next = button(STR.common.next, () => go(6), { primary: true, id: 'next' }); next.hidden = !lv.examPassed
      const run = button(S().steps[5].run, () => {
        if (play) return
        run.disabled = true; fb.replaceChildren(); list.replaceChildren(); truthRing.visible = false
        const opts = { width: lv.width, mode: 'depth', gap: lv.gap, bounceRule: lv.bounceRule }
        const ex = V.exam({ ...opts, keepFrames: true })
        let i = 0, hits = 0
        const one = () => {
          if (i >= ex.results.length) {
            run.disabled = false
            lv.examHits = ex.hits; lv.examPassed = ex.pass; app.save()
            const text = (ex.pass ? S().pop.examPass : S().pop.examFail).replace('{hits}', ex.hits)
            fb.replaceChildren(feedback(text, ex.pass ? 'good' : 'bad')); audio.play(ex.pass ? 'badge' : 'fail')
            if (ex.pass) next.hidden = false
            teach(text, ex.pass ? 'good' : 'bad')
            return
          }
          const r = ex.results[i]
          status.textContent = S().steps[5].serving.replace('{n}', i + 1).replace('{hits}', hits)
          playTrack(r, { speed: 1, onFrame: fr => { vw.show(fr); ro.show(fr) }, onDone: () => {
            ro.show(r.decision)
            if (r.hit) hits++
            const line = el('div', `examline ${r.hit ? 'ok' : 'miss'}`, `${i + 1} · ` + (r.decision ? (r.hit ? S().steps[5].result : S().steps[5].miss).replace('{err}', cm(r.decision.err)) : S().steps[5].none))
            line.dataset.id = `exam-${i}`
            list.append(line); audio.play(r.hit ? 'hit' : 'fail')
            i++; one()
          } })
        }
        one()
      }, { primary: true, id: 'run' })
      const skip = button(S().skip, () => { if (play) play.speed = 30 }, { id: 'skip', cls: 'small' })
      return panel({ title: S().steps[5].title, lead: S().steps[5].lead, note: S().steps[5].note, body: [vw, ro, status, list, fb], actions: [run, skip, next] })
    },
    6: () => conceptCheck(app, 'vision', S().concept, () => go(7)),
    7: () => badgeScreen(app, 'vision', S().badge),
  }

  function go(n) {
    L.setStep(n)
    truthRing.visible = false; marker.visible = false; ball.visible = false
    L.show(steps[n]())
  }
  go(lv.done ? 1 : Math.min(lv.step, 5))
  app.onLeave = cleanup
}
