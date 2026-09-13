// Level 3 — Robot Eyes. Procedural photos, a real softmax classifier trained from the player's labels.
import { STR } from '../strings.js'
import { el, button, panel, metrics, feedback } from '../ui.js'
import * as V from '../sim/vision.js'
import { makeSpinner } from '../robot.js'
import { mountLevel, advance, conceptCheck, badgeScreen } from './common.js'
import { audio } from '../audio.js'

const S = () => STR.vision
const PHOTO = 96

export async function showLevel(app) {
  const { THREE, view, robot, state } = app
  const lv = state.levels.vision
  const L = mountLevel(app, 'vision', S().title)
  const sets = V.makeSets(11)
  app.debug = { ...(app.debug ?? {}), vision: sets }
  const byId = new Map([...sets.train, ...sets.test, ...sets.improve].map(s => [s.id, s]))

  // --- scene: a card held in front of the head camera; the head nods when a photo is picked ---
  const dressing = new THREE.Group()
  const cardCanvas = document.createElement('canvas'); cardCanvas.width = cardCanvas.height = 128
  const cardTex = new THREE.CanvasTexture(cardCanvas); cardTex.colorSpace = THREE.SRGBColorSpace
  const card = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), new THREE.MeshBasicMaterial({ map: cardTex }))
  card.position.set(0.8, 1.3, 0.55); card.rotation.y = 0.5
  const frame = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.46), new THREE.MeshStandardMaterial({ color: 0xf2f4f8 }))
  frame.position.copy(card.position).add(new THREE.Vector3(-0.005, 0, -0.008)); frame.rotation.copy(card.rotation)
  dressing.add(frame, card)
  view.scene.add(dressing)
  view.lookAt([1.9, 1.7, 2.3], [0.35, 1.15, 0], { width: 2.2, height: 1.9 })
  const head = makeSpinner(robot, 'head__head__head__head')
  let nod = 0
  app.tick = dt => { nod = Math.max(0, nod - dt); head.setAngle(-0.25 * Math.sin(nod * Math.PI * 2) * (nod > 0 ? 1 : 0)) }
  const showOnCard = s => {
    const ctx = cardCanvas.getContext('2d')
    if (s) V.renderSample(s, ctx, 128); else { ctx.fillStyle = '#ddd'; ctx.fillRect(0, 0, 128, 128) }
    cardTex.needsUpdate = true; nod = 0.6
  }
  showOnCard(null)
  const cleanup = () => { view.scene.remove(dressing); head.setAngle(0); app.tick = null }

  // --- state ---
  lv.labels ??= {}
  const labelled = ids => ids.filter(id => lv.labels[id]).map(id => ({ features: V.features(byId.get(id)), label: lv.labels[id] }))
  const counts = ids => Object.fromEntries(V.LABELS.map(l => [l, ids.filter(id => lv.labels[id] === l).length]))
  const scoreOn = (model, set) => set.map(s => ({ s, p: V.predict(model, V.features(s)) }))

  // Photo grid. mode 'label': tap selects, label bar applies. mode 'show': read-only with tags.
  function photoGrid(samples, { mode, tags, onSelect } = {}) {
    const grid = el('div', 'photos')
    const elems = new Map()
    for (const s of samples) {
      const ph = el('div', 'photo'); ph.dataset.id = s.id
      const c = el('canvas'); c.width = c.height = PHOTO
      V.renderSample(s, c.getContext('2d'), PHOTO)
      const tag = el('div', 'tag', '')
      ph.append(c, tag)
      c.addEventListener('click', () => { showOnCard(s); if (mode === 'label') select(s.id); onSelect?.(s) })
      grid.append(ph); elems.set(s.id, ph)
    }
    let selected = null
    const select = id => {
      selected = id
      for (const [k, e] of elems) e.classList.toggle('selected', k === id)
    }
    const refresh = () => {
      for (const [id, e] of elems) {
        const t = tags?.(id)
        e.querySelector('.tag').textContent = t?.text ?? (lv.labels[id] ? S().labels[lv.labels[id]] : '?')
        e.classList.toggle('ok', t?.kind === 'ok'); e.classList.toggle('miss', t?.kind === 'miss')
      }
    }
    refresh()
    grid.select = select; grid.refresh = refresh; grid.selectedId = () => selected
    grid.nextUnlabelled = () => samples.find(s => !lv.labels[s.id])?.id ?? null
    return grid
  }

  function labelStep(ids, samples, cfg) {
    const grid = photoGrid(samples, { mode: 'label' })
    const bar = el('div', 'labelbar')
    const status = el('div')
    const next = button(STR.common.next, cfg.onNext, { primary: true, id: 'next' }); next.hidden = true
    const update = () => {
      const c = counts(ids), done = ids.every(id => lv.labels[id]), enough = V.LABELS.every(l => c[l] >= 2)
      status.replaceChildren(metrics(V.LABELS.map(l => ({ id: `count-${l}`, label: S().labels[l], value: `${c[l]}` }))))
      if (done && enough) { next.hidden = false; if (!cfg.trainAfter) audio.play('pass') }
      else if (done && !enough) status.append(feedback(S().steps[1].needTwo, 'bad'))
      grid.refresh()
    }
    for (const l of V.LABELS) bar.append(button(S().labels[l], () => {
      const id = grid.selectedId(); if (!id) return
      lv.labels[id] = l; app.save(); update()
      const n = grid.nextUnlabelled(); if (n) { grid.select(n); showOnCard(byId.get(n)) }
    }, { id: `label-${l}` }))
    const first = grid.nextUnlabelled() ?? ids[0]
    grid.select(first); showOnCard(byId.get(first))
    update()
    return panel({ title: cfg.title, lead: cfg.lead, note: cfg.note, body: [grid, bar, status], actions: [next] })
  }

  const trainIds = sets.train.map(s => s.id), improveIds = sets.improve.map(s => s.id)

  const steps = {
    1: () => labelStep(trainIds, sets.train, { title: S().steps[1].title, lead: S().steps[1].lead, note: S().steps[1].note, onNext: () => { advance(app, 'vision', 2); go(2) } }),
    2: () => {
      const fb = el('div')
      const next = button(STR.common.next, () => { advance(app, 'vision', 3); go(3) }, { primary: true, id: 'next' }); next.hidden = !lv.model
      const grid = photoGrid(sets.train, { mode: 'show' })
      const trainBtn = button(S().steps[2].train, () => {
        try {
          const m = V.trainClassifier(labelled(trainIds))
          lv.model = { weights: m.weights, bias: m.bias }; app.save()
          fb.replaceChildren(feedback(S().steps[2].done.replace('{acc}', Math.round(m.accuracy * 100)).replace('{n}', m.examples), 'good'))
          audio.play('pass'); next.hidden = false
        } catch (e) { fb.replaceChildren(feedback(S().steps[1].needTwo, 'bad')) }
      }, { primary: true, id: 'train' })
      return panel({ title: S().steps[2].title, lead: S().steps[2].lead, note: S().steps[2].note, body: [grid, fb], actions: [trainBtn, next] })
    },
    3: () => {
      const res = scoreOn(lv.model, sets.test)
      const byRes = new Map(res.map(r => [r.s.id, r]))
      const grid = photoGrid(sets.test, { mode: 'show', tags: id => { const r = byRes.get(id); return { text: `${S().labels[r.p.label]} ${r.p.label === r.s.truth ? '✓' : '✗'}`, kind: r.p.label === r.s.truth ? 'ok' : 'miss' } } })
      const per = V.LABELS.map(l => ({ id: `test-${l}`, label: S().labels[l], value: `${res.filter(r => r.s.truth === l && r.p.label === l).length}/4` }))
      const total = res.filter(r => r.p.label === r.s.truth).length
      lv.testBefore = total; app.save()
      const next = button(STR.common.next, () => { advance(app, 'vision', 4); go(4) }, { primary: true, id: 'next' })
      return panel({ title: S().steps[3].title, lead: S().steps[3].lead.replace('{n}', total), note: S().steps[3].note, body: [metrics([{ id: 'test-total', label: S().steps[3].total, value: `${total}/12` }, ...per]), grid], actions: [next] })
    },
    4: () => {
      const p = labelStep(improveIds, sets.improve, { title: S().steps[4].title, lead: S().steps[4].lead, note: S().steps[4].note, trainAfter: true, onNext: () => { advance(app, 'vision', 5); go(5) } })
      const fb = el('div')
      const retrain = button(S().steps[4].retrain, () => {
        try {
          const m = V.trainClassifier(labelled([...trainIds, ...improveIds]))
          lv.model2 = { weights: m.weights, bias: m.bias }
          const after = scoreOn(lv.model2, sets.test).filter(r => r.p.label === r.s.truth).length
          const hardBefore = scoreOn(lv.model, sets.improve).filter(r => r.p.label === r.s.truth).length
          const hardAfter = scoreOn(lv.model2, sets.improve).filter(r => r.p.label === r.s.truth).length
          lv.retrained = { testBefore: lv.testBefore, testAfter: after, hardBefore, hardAfter }; app.save()
          fb.replaceChildren(metrics([
            { id: 'cmp-test-before', label: S().steps[4].m.testBefore, value: `${lv.testBefore}/12` },
            { id: 'cmp-test-after', label: S().steps[4].m.testAfter, value: `${after}/12`, kind: after >= lv.testBefore ? 'good' : 'bad' },
            { id: 'cmp-hard-before', label: S().steps[4].m.hardBefore, value: `${hardBefore}/6` },
            { id: 'cmp-hard-after', label: S().steps[4].m.hardAfter, value: `${hardAfter}/6`, kind: hardAfter > hardBefore ? 'good' : 'bad' },
          ]), feedback(S().steps[4].done, 'good'))
          audio.play('pass'); p.querySelector('[data-id=next]').hidden = false
        } catch (e) { fb.replaceChildren(feedback(S().steps[1].needTwo, 'bad')) }
      }, { primary: true, id: 'retrain' })
      p.querySelector('[data-id=next]').hidden = true
      p.insertBefore(fb, p.actionsEl)
      p.actionsEl.prepend(retrain)
      return p
    },
    5: () => {
      const model = lv.model2 ?? lv.model
      const input = el('input'); input.type = 'file'; input.accept = 'image/*'; input.setAttribute('capture', 'environment'); input.dataset.id = 'photo'; input.hidden = true
      const pick = button(S().steps[5].pick, () => input.click(), { primary: true, id: 'pick' })
      const preview = el('canvas', 'preview'); preview.width = preview.height = 160; preview.hidden = true
      const fb = el('div')
      const next = button(STR.common.next, () => go(6), { primary: true, id: 'next' }); next.hidden = true
      input.addEventListener('change', async () => {
        const file = input.files?.[0]; if (!file) return
        try {
          const bmp = await createImageBitmap(file)
          const ctx = preview.getContext('2d')
          const s = Math.min(bmp.width, bmp.height)
          ctx.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 160, 160)
          preview.hidden = false
          const f = V.cropFeatures(ctx, 160, 160)
          const r = V.predict(model, f)
          ctx.strokeStyle = '#ffb547'; ctx.lineWidth = 3; ctx.strokeRect(48, 48, 64, 64)
          const cardCtx = cardCanvas.getContext('2d'); cardCtx.drawImage(preview, 0, 0, 128, 128); cardTex.needsUpdate = true; nod = 0.6
          fb.replaceChildren(
            feedback(S().steps[5].result.replace('{label}', S().labels[r.label]).replace('{pct}', Math.round(r.scores[r.label] * 100)), 'good'),
            metrics(V.LABELS.map(l => ({ id: `score-${l}`, label: S().labels[l], value: `${Math.round(r.scores[l] * 100)}%` }))),
            el('p', 'note', S().steps[5].caveat),
          )
          lv.realPhoto = r.label; app.save()
          audio.play('pass'); next.hidden = false
        } catch { fb.replaceChildren(feedback(S().steps[5].failed, 'bad')) }
      })
      return panel({ title: S().steps[5].title, lead: S().steps[5].lead, note: S().steps[5].note, body: [input, preview, fb], actions: [pick, next] })
    },
    6: () => conceptCheck(app, 'vision', S().concept, () => go(7)),
    7: () => badgeScreen(app, 'vision', S().badge),
  }

  function go(n) {
    L.setStep(n)
    L.show(steps[n]())
  }
  go(lv.done ? 1 : Math.min(lv.step, 5))
  app.onLeave = cleanup
}
