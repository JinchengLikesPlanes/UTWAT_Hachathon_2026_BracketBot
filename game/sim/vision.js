// Level 3: procedural "photos" from BracketBot's head camera and a linear softmax colour classifier.
// Classifier = the Learning Lab's: 3→3 linear, cross-entropy, full-batch SGD lr 0.45, weight decay
// 0.002, 180 epochs, fixed init (seed 7). Feature = mean RGB of the centre 40 % crop, / 255.
import { rng as makeRng } from '../rng.js'

export const LABELS = ['red', 'blue', 'yellow']
export const CROP = 0.4          // centre crop, fraction of the photo side
const OBJ_R = 0.31               // object radius (fraction of side): fully covers the crop
const SHADE = 0.35               // radial darkening at the object's rim

const HUES = { red: 0, blue: 222, yellow: 54 }

function hsv(h, s, v) {
  h = ((h % 360) + 360) % 360
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

let nextId = 0
function sample(rng, truth, { hueJitter = 12, sat = [0.75, 1], val = [0.8, 1], light = [0.7, 1.1], bgWarm = null } = {}, set) {
  const h = HUES[truth] + rng.range(-hueJitter, hueJitter)
  const objectRGB = hsv(h, rng.range(...sat), rng.range(...val))
  const bgHue = bgWarm === null ? rng.range(0, 360) : bgWarm
  const bgRGB = hsv(bgHue, rng.range(0.1, 0.35), rng.range(0.55, 0.95))
  return { id: `${set}-${nextId++}`, truth, objectRGB, bgRGB, light: rng.range(...light) }
}

export function makeSets(seed = 11) {
  nextId = 0
  const rng = makeRng(seed)
  const train = [], test = [], improve = []
  for (let i = 0; i < 6; i++) for (const t of LABELS) train.push(sample(rng, t, {}, 'train'))
  for (let i = 0; i < 4; i++) for (const t of LABELS) test.push(sample(rng, t, { hueJitter: 14, light: [0.55, 1.15] }, 'test'))
  for (let i = 0; i < 2; i++) {
    improve.push(sample(rng, 'yellow', { hueJitter: 4, sat: [0.55, 0.7], val: [0.8, 0.9], light: [0.5, 0.6], bgWarm: 35 }, 'improve'))
    improve.push(sample(rng, 'blue', { hueJitter: 3, sat: [0.65, 0.8], val: [0.85, 1], light: [0.8, 1] }, 'improve'))
    improve.push(sample(rng, 'red', { hueJitter: 3, sat: [0.85, 1], val: [0.9, 1], light: [0.8, 1] }, 'improve'))
  }
  improve[0].objectRGB = hsv(40, 0.6, 0.85); improve[3].objectRGB = hsv(38, 0.62, 0.8); improve[0].light = 0.45; improve[3].light = 0.5   // dim, brownish yellow
  improve[1].objectRGB = hsv(262, 0.72, 0.95); improve[4].objectRGB = hsv(258, 0.7, 0.9)        // purple-leaning blue
  improve[2].objectRGB = hsv(30, 0.95, 1); improve[5].objectRGB = hsv(28, 0.92, 0.97)           // orange-leaning red
  // shuffle each set so classes are not in a fixed order
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rng.int(i + 1); [a[i], a[j]] = [a[j], a[i]] } return a }
  return { train: shuffle(train), test: shuffle(test), improve: shuffle(improve) }
}

// Pixel colour at (u, v) ∈ [0,1]², matching renderSample exactly.
function pixel(s, u, v) {
  const dx = u - 0.5, dy = v - 0.5, r2 = dx * dx + dy * dy
  const base = r2 <= OBJ_R * OBJ_R ? s.objectRGB.map(c => c * (1 - SHADE * r2 / (OBJ_R * OBJ_R))) : s.bgRGB
  return base.map(c => Math.min(255, c * s.light))
}

export function renderSample(s, ctx, size) {
  const img = ctx.createImageData(size, size)
  const d = img.data
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const [r, g, b] = pixel(s, (x + 0.5) / size, (y + 0.5) / size)
    const i = (y * size + x) * 4
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
}

// Analytic mean of the centre crop: the object covers it fully, so only the radial shade varies.
// mean(r²) over a square of half-side a is 2a²/3.
export function features(s) {
  const a = CROP / 2
  const meanShade = 1 - SHADE * (2 * a * a / 3) / (OBJ_R * OBJ_R)
  return s.objectRGB.map(c => Math.min(255, c * meanShade * s.light) / 255)
}

// Mean RGB of the centre crop of any canvas (used for the player's real photo).
export function cropFeatures(ctx, w, h) {
  const cw = Math.max(1, Math.round(w * CROP)), ch = Math.max(1, Math.round(h * CROP))
  const d = ctx.getImageData(Math.round((w - cw) / 2), Math.round((h - ch) / 2), cw, ch).data
  const sum = [0, 0, 0]
  for (let i = 0; i < d.length; i += 4) { sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2] }
  const n = d.length / 4
  return sum.map(v => v / n / 255)
}

function softmax(z) {
  const m = Math.max(...z), e = z.map(v => Math.exp(v - m)), s = e.reduce((a, b) => a + b, 0)
  return e.map(v => v / s)
}

export function trainClassifier(samples, { epochs = 180, lr = 0.45, weightDecay = 0.002, seed = 7 } = {}) {
  const counts = Object.fromEntries(LABELS.map(l => [l, 0]))
  for (const s of samples) { if (!LABELS.includes(s.label)) throw new Error(`bad label ${s.label}`); counts[s.label]++ }
  for (const l of LABELS) if (counts[l] < 2) throw new Error(`need at least 2 examples of ${l}`)
  const rng = makeRng(seed), k = 1 / Math.sqrt(3)
  const W = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => rng.range(-k, k)))
  const b = Array.from({ length: 3 }, () => rng.range(-k, k))
  const X = samples.map(s => s.features), Y = samples.map(s => LABELS.indexOf(s.label))
  const n = X.length
  for (let ep = 0; ep < epochs; ep++) {
    const gW = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], gb = [0, 0, 0]
    for (let i = 0; i < n; i++) {
      const p = softmax(W.map((row, c) => row[0] * X[i][0] + row[1] * X[i][1] + row[2] * X[i][2] + b[c]))
      for (let c = 0; c < 3; c++) {
        const g = (p[c] - (Y[i] === c ? 1 : 0)) / n
        gb[c] += g
        for (let j = 0; j < 3; j++) gW[c][j] += g * X[i][j]
      }
    }
    for (let c = 0; c < 3; c++) { b[c] -= lr * gb[c]; for (let j = 0; j < 3; j++) W[c][j] -= lr * (gW[c][j] + weightDecay * W[c][j]) }
  }
  const model = { weights: W, bias: b }
  const correct = samples.filter(s => predict(model, s.features).label === s.label).length
  return { ...model, accuracy: correct / n, examples: n, epochs }
}

export function predict(model, f) {
  const z = model.weights.map((row, c) => row[0] * f[0] + row[1] * f[1] + row[2] * f[2] + model.bias[c])
  const p = softmax(z)
  let best = 0
  for (let c = 1; c < 3; c++) if (p[c] > p[best]) best = c
  return { label: LABELS[best], scores: Object.fromEntries(LABELS.map((l, i) => [l, p[i]])) }
}
