// SFX and music. Synthesised with Web Audio until Task 12 wires generated files (same ids).
let ctx = null, unlocked = false, musicNode = null
const files = new Map()   // id → AudioBuffer (Task 12)

function ensure() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
  if (ctx.state === 'suspended') ctx.resume()
  unlocked = true
}
addEventListener('pointerdown', ensure, { once: true })
addEventListener('keydown', ensure, { once: true })

const SYNTH = {
  click:  { f: 660, f2: 880, d: 0.06, type: 'square', g: 0.05 },
  pass:   { f: 523, f2: 1046, d: 0.35, type: 'triangle', g: 0.12 },
  fail:   { f: 220, f2: 110, d: 0.3, type: 'sawtooth', g: 0.08 },
  hit:    { f: 900, f2: 300, d: 0.08, type: 'square', g: 0.08 },
  bounce: { f: 300, f2: 200, d: 0.07, type: 'sine', g: 0.1 },
  badge:  { f: 392, f2: 1568, d: 0.8, type: 'triangle', g: 0.14 },
}

function play(id) {
  if (!unlocked || !ctx) return
  try {
    if (files.has(id)) {
      const s = ctx.createBufferSource(); s.buffer = files.get(id); s.connect(ctx.destination); s.start(); return
    }
    const p = SYNTH[id]; if (!p) return
    const o = ctx.createOscillator(), g = ctx.createGain()
    o.type = p.type; o.frequency.setValueAtTime(p.f, ctx.currentTime)
    o.frequency.exponentialRampToValueAtTime(p.f2, ctx.currentTime + p.d)
    g.gain.setValueAtTime(p.g, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + p.d)
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + p.d)
  } catch { /* audio unavailable */ }
}

function music(id) {
  try { musicNode?.stop(); musicNode = null } catch { /* ignore */ }
  if (!id || !unlocked || !ctx || !files.has(id)) return
  musicNode = ctx.createBufferSource(); musicNode.buffer = files.get(id); musicNode.loop = true
  const g = ctx.createGain(); g.gain.value = 0.35
  musicNode.connect(g).connect(ctx.destination); musicNode.start()
}

async function loadFile(id, url) {
  try {
    ensure()
    const buf = await (await fetch(url)).arrayBuffer()
    files.set(id, await ctx.decodeAudioData(buf))
  } catch { /* fall back to synth */ }
}

export const audio = { play, music, loadFile }
