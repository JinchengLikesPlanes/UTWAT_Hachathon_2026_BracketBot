// Full-flow browser check. Serve the game first:  cd game && python3 -m http.server 8000
// Run from the repo root:  node game/tests/browser.mjs
// Env: GAME_URL (default http://127.0.0.1:8000), CHROME_PATH, ONLY=pid|rl|vision|phone
import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const baseURL = process.env.GAME_URL || 'http://127.0.0.1:8000'
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const only = process.env.ONLY
const out = fileURLToPath(new URL('../../artifacts/game-qa/', import.meta.url))
await mkdir(out, { recursive: true })

const browser = await chromium.launch({ headless: true, executablePath: chrome })
const errors = [], steps = []
const ok = (name, cond, detail = '') => { steps.push({ name, pass: !!cond, detail }); console.log(`${cond ? '✔' : '✖'} ${name} ${detail}`); if (!cond) throw new Error(`step failed: ${name} ${detail}`) }

async function open(ctxOpts = {}, query = '') {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...ctxOpts })
  const page = await ctx.newPage()
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(String(e)))
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`) })
  await page.goto(baseURL + '/' + query, { waitUntil: 'commit' })
  await page.waitForFunction(() => window.bb?.robot, null, { timeout: 60000 })
  return { ctx, page }
}
const btn = (page, id) => page.locator(`button[data-id="${id}"]`)
const setSlider = async (page, id, v) => {
  await page.locator(`input[data-id="${id}"]`).evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })) }, v)
}
// Press run, fast-forward, wait for the run to finish (run button re-enabled).
const runTrial = async page => {
  await btn(page, 'run').click()
  await btn(page, 'skip').click()
  await page.waitForFunction(() => !document.querySelector('button[data-id="run"]').disabled, null, { timeout: 20000 })
}
const nextVisible = page => page.waitForSelector('button[data-id="next"]:not([hidden])', { timeout: 5000 })

async function pidLevel(page, { touch = false } = {}) {
  const tap = async id => touch ? btn(page, id).tap() : btn(page, id).click()
  await tap('play-pid')
  await page.waitForSelector('button[data-id="run"]')
  // step 1: it falls
  await runTrial(page); await nextVisible(page)
  ok('pid step1 falls', /Fell at/.test(await page.locator('[data-id=stood] .v').textContent()))
  await tap('next')
  // step 2: P alone still falls, but later
  await setSlider(page, 'kp', 6); await runTrial(page); await nextVisible(page)
  ok('pid step2 P alone falls later', /Fell at/.test(await page.locator('[data-id=stood] .v').textContent()))
  await tap('next')
  // step 3: D makes it stand
  await setSlider(page, 'kp', 6); await setSlider(page, 'kd', 5); await runTrial(page); await nextVisible(page)
  ok('pid step3 stands', (await page.locator('[data-id=stood] .v').textContent()) === 'Yes')
  await tap('next')
  // step 4: hold brings it back
  await runTrial(page)
  ok('pid step4 needs hold', await page.locator('.feedback').getAttribute('data-kind') !== 'good')
  await setSlider(page, 'kh', 5); await runTrial(page); await nextVisible(page); await tap('next')
  // step 5: exam — steady pull without I parks off the line, then reference gains pass
  await tap('dist-steady_pull'); await runTrial(page)
  ok('pid exam steady pull needs I', await page.locator('.feedback').getAttribute('data-kind') === 'bad')
  await setSlider(page, 'kp', 6); await setSlider(page, 'kd', 5); await setSlider(page, 'kh', 5); await setSlider(page, 'ki', 5)
  for (const d of ['push', 'long_push', 'steady_pull']) { await tap(`dist-${d}`); await runTrial(page) }
  await nextVisible(page); await tap('next')
  // concept
  await tap('choice-0')
  ok('pid wrong answer shows retry', await page.locator('.feedback.bad').count() === 1)
  await tap('choice-1'); await nextVisible(page); await tap('next')
  await page.waitForSelector('button[data-id="to-hub"]')
  const done = await page.evaluate(() => JSON.parse(localStorage.getItem('bb-game-v1')).levels.pid.done)
  ok('pid badge + state.done', done)
  await tap('real'); ok('pid real-robot card', await page.locator('[data-modal=real]').count() === 1); await tap('close-real')
  await tap('to-hub')
  await page.reload({ waitUntil: 'commit' }); await page.waitForFunction(() => window.bb?.robot)
  ok('pid badge survives reload', (await page.locator('[data-level=pid] .progress').textContent()) === 'Badge earned')
}

// A 64×64 solid-colour PNG built in the browser (no file on disk needed).
const pngBuffer = async (page, css) => Buffer.from(await page.evaluate(async css => {
  const c = document.createElement('canvas'); c.width = c.height = 64
  const ctx = c.getContext('2d'); ctx.fillStyle = css; ctx.fillRect(0, 0, 64, 64)
  const blob = await new Promise(r => c.toBlob(r, 'image/png'))
  return [...new Uint8Array(await blob.arrayBuffer())]
}, css))

async function visionLevel(page) {
  await btn(page, 'play-vision').click()
  await page.waitForSelector('.photos')
  const labelAll = async () => {
    const ids = await page.$$eval('.photos .photo', els => els.map(e => e.dataset.id))
    const truth = await page.evaluate(() => Object.fromEntries([...window.bb.debug.vision.train, ...window.bb.debug.vision.improve].map(s => [s.id, s.truth])))
    for (const id of ids) { await page.locator(`.photo[data-id="${id}"] canvas`).click(); await btn(page, `label-${truth[id]}`).click() }
  }
  await labelAll(); await nextVisible(page); await btn(page, 'next').click()
  await btn(page, 'train').click(); await nextVisible(page)
  ok('vision trained', await page.locator('.feedback.good').count() === 1)
  await btn(page, 'next').click()
  const total = await page.locator('[data-id=test-total] .v').textContent()
  ok('vision test ≥ 10/12', +total.split('/')[0] >= 10, total)
  await btn(page, 'next').click()
  await labelAll(); await btn(page, 'retrain').click(); await nextVisible(page)
  const hardAfter = await page.locator('[data-id=cmp-hard-after] .v').textContent()
  ok('vision retrain shows comparison', /\/6/.test(hardAfter), hardAfter)
  await btn(page, 'next').click()
  await page.locator('input[data-id="photo"]').setInputFiles({ name: 'red.png', mimeType: 'image/png', buffer: await pngBuffer(page, '#d62828') })
  await nextVisible(page)
  const said = await page.locator('.feedback.good').textContent()
  ok('vision real photo → red', /Red/.test(said), said)
  await btn(page, 'next').click()
  await btn(page, 'choice-1').click(); await nextVisible(page); await btn(page, 'next').click()
  await page.waitForSelector('button[data-id="to-hub"]'); await btn(page, 'to-hub').click()
  await page.reload({ waitUntil: 'commit' }); await page.waitForFunction(() => window.bb?.robot)
  ok('vision badge survives reload', (await page.locator('[data-level=vision] .progress').textContent()) === 'Badge earned')
}

async function rlLevel(page) {
  await btn(page, 'play-rl').click()
  await page.waitForSelector('button[data-id="replay-0"]')
  // step 1: replays exist; pick wrong then right (A is the legal one by construction: order [2,0,1])
  await btn(page, 'replay-1').click(); await page.waitForTimeout(300)
  await btn(page, 'choice-1').click()
  ok('rl step1 wrong pick', await page.locator('.feedback.bad').count() === 1)
  await btn(page, 'choice-0').click(); await nextVisible(page); await btn(page, 'next').click()
  // step 2: cards via Move buttons (sense = 1 move, control = 2 moves)
  for (const id of ['x', 'y', 'vx', 'vy']) await btn(page, `move-${id}`).click()
  for (const id of ['h', 't']) { await btn(page, `move-${id}`).click(); await btn(page, `move-${id}`).click() }
  await btn(page, 'check').click(); await nextVisible(page); await btn(page, 'next').click()
  // step 3: pick the return preset
  await btn(page, 'preset-return').click(); await nextVisible(page); await btn(page, 'next').click()
  // step 4: train 300 episodes (~15 s at 20/s)
  await btn(page, 'train').click()
  await page.waitForSelector('button[data-id="next"]:not([hidden])', { timeout: 40000 })
  const ep = await page.locator('[data-id=ep] .v').textContent()
  ok('rl trained 300', ep === '300/300', ep)
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bb-game-v1')).levels.rl)
  ok('rl policy persisted', saved.policy && saved.policy.episodes === 300 && saved.preset === 'return')
  await btn(page, 'next').click()
  // step 5: evaluate
  await btn(page, 'run').click(); await btn(page, 'skip').click()
  await page.waitForSelector('button[data-id="next"]:not([hidden])', { timeout: 60000 })
  const al = +(await page.locator('[data-id=a-leg] .v').textContent()), bl = +(await page.locator('[data-id=b-leg] .v').textContent())
  ok('rl after > before on unseen serves', al > bl, `${bl} → ${al}`)
  await btn(page, 'next').click()
  await btn(page, 'choice-1').click(); await nextVisible(page); await btn(page, 'next').click()
  await page.waitForSelector('button[data-id="to-hub"]')
  await btn(page, 'to-hub').click()
  await page.reload({ waitUntil: 'commit' }); await page.waitForFunction(() => window.bb?.robot)
  ok('rl badge survives reload', (await page.locator('[data-level=rl] .progress').textContent()) === 'Badge earned')
}

try {
  if (!only || only === 'vision') {
    const { ctx, page } = await open()
    await visionLevel(page)
    await page.screenshot({ path: out + 'hub-after-vision.png' })
    await ctx.close()
  }
  if (!only || only === 'rl') {
    const { ctx, page } = await open()
    await rlLevel(page)
    await page.screenshot({ path: out + 'hub-after-rl.png' })
    await ctx.close()
  }
  if (!only || only === 'pid') {
    const { ctx, page } = await open()
    await pidLevel(page)
    await page.screenshot({ path: out + 'hub-after-pid.png' })
    await ctx.close()
  }
  if (!only || only === 'phone') {
    const { ctx, page } = await open({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    await pidLevel(page, { touch: true })
    await page.screenshot({ path: out + 'phone-hub.png' })
    await ctx.close()
  }
  if (!only || only === 'perf') {
    const { ctx, page } = await open({}, '?dev=1')
    await page.evaluate(() => { const s = window.bb.state; s.levels.rl.step = 4; localStorage.setItem('bb-game-v1', JSON.stringify(s)) })
    await page.reload({ waitUntil: 'commit' }); await page.waitForFunction(() => window.bb?.robot)
    await btn(page, 'play-rl').click(); await page.waitForSelector('button[data-id="train"]')
    await btn(page, 'train').click(); await page.waitForTimeout(4000)
    const fps = +(await page.locator('#dev').getAttribute('data-fps'))
    ok('rally scene fps ≥ 30 while training (headless)', fps >= 30, `${fps} fps — ${await page.locator('#dev').textContent()}`)
    await ctx.close()
  }
  ok('no console errors / 404s', errors.length === 0, errors.join(' | '))
  console.log(`\nALL ${steps.length} CHECKS PASSED`)
} catch (e) {
  console.error('\nFAILED:', e.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
