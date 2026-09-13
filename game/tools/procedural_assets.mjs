// Fallback asset generator (design/assets.csv rows with source=procedural).
// Renders PNGs with a headless Chrome canvas so the game ships complete without generated art.
//   node game/tools/procedural_assets.mjs        (run from the repo root; needs web/node_modules)
import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')
await mkdir(out, { recursive: true })
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await chromium.launch({ headless: true, executablePath: chrome })
const page = await browser.newPage()

const draw = (w, h, fn) => page.evaluate(({ w, h, src }) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const ctx = c.getContext('2d')
  new Function('ctx', 'w', 'h', src)(ctx, w, h)
  return c.toDataURL('image/png').split(',')[1]
}, { w, h, src: fn })

const files = {
  'tex_floor.png': [512, 512, `
    ctx.fillStyle = '#F1EBE3'; ctx.fillRect(0, 0, w, h)
    for (let i = 0; i < 6000; i++) { ctx.fillStyle = 'rgba(23,23,23,' + (Math.random() * 0.06) + ')'; ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2) }
    ctx.strokeStyle = 'rgba(23,23,23,.10)'; ctx.lineWidth = 2
    for (let x = 0; x <= w; x += 128) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke() }
    for (let y = 0; y <= h; y += 128) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }`],
  'tex_table.png': [512, 512, `
    ctx.fillStyle = '#4B4641'; ctx.fillRect(0, 0, w, h)
    for (let i = 0; i < 6000; i++) { ctx.fillStyle = 'rgba(0,0,0,' + (Math.random() * 0.08) + ')'; ctx.fillRect(Math.random() * w, Math.random() * h, 3, 1) }
    for (let i = 0; i < 3000; i++) { ctx.fillStyle = 'rgba(255,255,255,' + (Math.random() * 0.05) + ')'; ctx.fillRect(Math.random() * w, Math.random() * h, 2, 1) }`],
  'spr_hub_bg.png': [1280, 720, `
    ctx.fillStyle = '#FBF8F5'; ctx.fillRect(0, 0, w, h)
    for (let i = 0; i < 40000; i++) { ctx.fillStyle = 'rgba(23,23,23,' + (Math.random() * 0.08) + ')'; ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1) }`],
}
const badge = (glyph) => [512, 512, `
  ctx.translate(w / 2, h / 2)
  ctx.fillStyle = '#171717'; ctx.beginPath(); ctx.arc(0, 0, 220, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(0, 0, 196, 0, Math.PI * 2); ctx.stroke()
  ctx.fillStyle = '#fff'; ctx.font = '700 200px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('${glyph}', 0, 10)`]
files['spr_badge_pid.png'] = badge('1')
files['spr_badge_rl.png'] = badge('3')
files['spr_badge_vision.png'] = badge('2')

for (const [name, [w, h, src]] of Object.entries(files)) {
  const b64 = await draw(w, h, src)
  await writeFile(join(out, name), Buffer.from(b64, 'base64'))
  console.log('wrote', name)
}
await browser.close()
