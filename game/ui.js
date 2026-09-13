// DOM overlay kit. Every function returns an element; all text is passed in by the caller (from STR).
import { audio } from './audio.js'

export const el = (tag, cls, text) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

export function button(label, onClick, { primary = false, cls = '', id } = {}) {
  const b = el('button', `btn ${primary ? 'primary' : ''} ${cls}`.trim(), label)
  if (id) b.dataset.id = id
  b.addEventListener('click', e => { audio.play('click'); onClick?.(e) })
  return b
}

export function topbar(title, steps, onBack, backLabel) {
  const bar = el('div', 'topbar')
  bar.append(button(backLabel, onBack, { cls: 'small', id: 'back' }), el('h1', '', title))
  const s = el('span', 'steps', steps ?? '')
  bar.append(s)
  bar.setSteps = t => { s.textContent = t }
  return bar
}

// Right-hand (desktop) / bottom (phone) panel. `body` and `actions` are arrays of elements.
export function panel({ title, lead, note, body = [], actions = [] }) {
  const p = el('section', 'panel')
  if (title) p.append(el('h2', '', title))
  if (lead) p.append(el('p', 'lead', lead))
  if (note) p.append(el('p', 'note', note))
  p.append(...body)
  const a = el('div', 'actions')
  a.append(...actions)
  p.append(a)
  p.actionsEl = a
  return p
}

export function feedback(text, kind = 'info') {
  const f = el('div', `feedback ${kind}`, text)
  f.dataset.kind = kind
  return f
}

export function slider({ label, min, max, step, value, onInput, id, format = v => v }) {
  const wrap = el('div', 'slider')
  const l = el('label', '', label)
  const out = el('output', '', format(value))
  const input = el('input')
  input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = value
  if (id) { input.dataset.id = id; input.id = `slider-${id}`; l.htmlFor = input.id }
  input.addEventListener('input', () => { out.textContent = format(+input.value); onInput?.(+input.value) })
  wrap.append(l, out, input)
  wrap.set = v => { input.value = v; out.textContent = format(v) }
  wrap.lock = on => { input.disabled = on; if (on) wrap.dataset.locked = '1'; else delete wrap.dataset.locked }
  wrap.input = input
  return wrap
}

export function metrics(items) {
  const m = el('div', 'metrics')
  for (const it of items) {
    const box = el('div', `metric ${it.kind ?? ''}`)
    box.append(el('div', 'k', it.label), el('div', 'v', it.value))
    box.dataset.id = it.id ?? ''
    m.append(box)
  }
  return m
}

// Multiple choice. onPick(index, buttonEl). Buttons stay so feedback can show; caller locks.
export function choice(options, onPick, { idPrefix = 'choice' } = {}) {
  const c = el('div', 'choice')
  options.forEach((label, i) => {
    const b = button(label, () => onPick(i, b), { id: `${idPrefix}-${i}` })
    c.append(b)
  })
  c.lock = () => c.querySelectorAll('button').forEach(b => { b.disabled = true })
  c.mark = (i, ok) => c.querySelectorAll('button')[i].classList.add(ok ? 'good' : 'danger')
  return c
}

// Cards dragged into zones. items: [{id, label}], zones: [{id, title}]. Pointer-event based so touch works.
// Each card also has a "move" button that cycles zones (keyboard / gamepad path).
export function cards(items, zones, onChange, { moveLabel = '→' } = {}) {
  const root = el('div')
  const bank = el('div', 'cardbank')
  const grid = el('div', 'dropzones')
  const zoneEls = new Map()
  const placement = new Map()
  for (const z of zones) {
    const ze = el('div', 'zone')
    ze.dataset.zone = z.id
    ze.append(el('h3', '', z.title))
    grid.append(ze)
    zoneEls.set(z.id, ze)
  }
  const cardEls = new Map()
  const place = (id, zoneId) => {
    placement.set(id, zoneId)
    const c = cardEls.get(id)
    ;(zoneId ? zoneEls.get(zoneId) : bank).append(c)
    onChange(Object.fromEntries(placement))
  }
  for (const it of items) {
    const c = el('div', 'card')
    c.dataset.card = it.id
    c.append(el('span', '', it.label))
    const mv = button(moveLabel, () => {
      const order = [null, ...zones.map(z => z.id)]
      const cur = placement.get(it.id) ?? null
      place(it.id, order[(order.indexOf(cur) + 1) % order.length])
    }, { cls: 'small move', id: `move-${it.id}` })
    c.append(mv)
    cardEls.set(it.id, c)
    placement.set(it.id, null)
    bank.append(c)
    let ghost = null, offX = 0, offY = 0
    c.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return
      c.setPointerCapture(e.pointerId)
      const r = c.getBoundingClientRect()
      offX = e.clientX - r.left; offY = e.clientY - r.top
      ghost = c.cloneNode(true); ghost.classList.add('dragging'); ghost.style.width = r.width + 'px'
      document.body.append(ghost)
      c.style.opacity = '.3'
    })
    c.addEventListener('pointermove', e => {
      if (!ghost) return
      ghost.style.left = e.clientX - offX + 'px'; ghost.style.top = e.clientY - offY + 'px'
      for (const ze of zoneEls.values()) ze.classList.toggle('over', hit(ze, e.clientX, e.clientY))
    })
    const end = e => {
      if (!ghost) return
      ghost.remove(); ghost = null; c.style.opacity = ''
      let dropped = null
      for (const [zid, ze] of zoneEls) { ze.classList.remove('over'); if (hit(ze, e.clientX, e.clientY)) dropped = zid }
      if (dropped !== null || hit(bank, e.clientX, e.clientY)) place(it.id, dropped)
    }
    c.addEventListener('pointerup', end)
    c.addEventListener('pointercancel', end)
  }
  root.append(bank, grid)
  root.place = place
  return root
}
const hit = (e, x, y) => { const r = e.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom }

// Line graph. series: [{points: [{t, y}], color}], yRange: [lo, hi], tRange: [0, T], bands: [{t0, t1, color}].
export function graph(canvasEl, { yRange = [-0.2, 0.2], tRange = [0, 8], yLines = [] } = {}) {
  const ctx = canvasEl.getContext('2d')
  function draw(series, bands = []) {
    const dpr = Math.min(devicePixelRatio || 1, 2)
    const w = canvasEl.clientWidth, h = canvasEl.clientHeight
    if (canvasEl.width !== w * dpr) { canvasEl.width = w * dpr; canvasEl.height = h * dpr }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const X = t => (t - tRange[0]) / (tRange[1] - tRange[0]) * w
    const Y = y => h - (y - yRange[0]) / (yRange[1] - yRange[0]) * h
    for (const b of bands) { ctx.fillStyle = b.color; ctx.fillRect(X(b.t0), 0, X(b.t1) - X(b.t0), h) }
    ctx.strokeStyle = '#2c3446'; ctx.lineWidth = 1
    for (const y of yLines) { ctx.beginPath(); ctx.moveTo(0, Y(y)); ctx.lineTo(w, Y(y)); ctx.stroke() }
    ctx.strokeStyle = '#4a5670'; ctx.beginPath(); ctx.moveTo(0, Y(0)); ctx.lineTo(w, Y(0)); ctx.stroke()
    for (const s of series) {
      if (!s.points.length) continue
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width ?? 2; ctx.beginPath()
      s.points.forEach((p, i) => i ? ctx.lineTo(X(p.t), Y(p.y)) : ctx.moveTo(X(p.t), Y(p.y)))
      ctx.stroke()
    }
  }
  return { draw }
}

export function toast(text) {
  const t = el('div', 'toast', text)
  document.getElementById('ui').append(t)
  setTimeout(() => t.remove(), 2500)
}

export function modal({ title, lines = [], warn, actions = [] }) {
  const m = el('div', 'modal')
  const box = el('div', 'box')
  box.append(el('h2', '', title))
  for (const l of lines) {
    if (Array.isArray(l)) { const ul = el('ul'); for (const li of l) ul.append(el('li', '', li)); box.append(ul) }
    else box.append(el('p', 'note', l))
  }
  if (warn) box.append(el('p', 'warn', warn))
  const a = el('div', 'row'); a.append(...actions); box.append(a)
  m.append(box)
  m.addEventListener('click', e => { if (e.target === m) m.remove() })
  return m
}

// Teaching pop-up: the result text jumps to the middle of the screen once a simulation ends.
export function popup({ title, text, kind = 'info', closeLabel, onClose }) {
  const m = el('div', 'modal pop')
  const box = el('div', `box ${kind}`)
  if (title) box.append(el('h2', '', title))
  box.append(el('p', 'lead', text))
  const a = el('div', 'row')
  a.append(button(closeLabel, () => { m.remove(); onClose?.() }, { primary: true, id: 'popup-close' }))
  box.append(a)
  m.append(box)
  m.dataset.modal = 'popup'
  document.getElementById('ui').append(m)
  return m
}

// Gamepad/keyboard focus: D-pad moves among visible buttons, A activates. Called from the main loop.
let focusIdx = -1, lastPad = 0
export function pollGamepad() {
  const pads = navigator.getGamepads?.() ?? []
  const gp = [...pads].find(Boolean)
  if (!gp) return
  const now = performance.now()
  if (now - lastPad < 180) return
  const btns = [...document.querySelectorAll('#ui button:not([disabled])')].filter(b => b.offsetParent)
  if (!btns.length) return
  const down = gp.buttons[13]?.pressed || gp.axes[1] > 0.5, up = gp.buttons[12]?.pressed || gp.axes[1] < -0.5
  const act = gp.buttons[0]?.pressed
  if (down || up) {
    focusIdx = ((focusIdx + (down ? 1 : -1)) % btns.length + btns.length) % btns.length
    btns.forEach(b => b.classList.remove('focused'))
    btns[focusIdx].classList.add('focused'); btns[focusIdx].focus()
    lastPad = now
  } else if (act && btns[focusIdx]) { btns[focusIdx].click(); lastPad = now }
}
