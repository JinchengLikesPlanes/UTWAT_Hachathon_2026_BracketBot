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
  if (await page.locator('[data-modal=popup]').count()) await btn(page, 'popup-close').click()
}
const dismiss = async page => { if (await page.locator('[data-modal=popup]').count()) await btn(page, 'popup-close').click() }
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
// Serve, fast-forward the playback, wait for the serve button to come back, dismiss the pop-up.
const serveOnce = async page => {
  await btn(page, 'serve').click()
  await page.evaluate(() => { const t = window.bb.tick; for (let i = 0; i < 400; i++) t(1 / 60) })
  await page.waitForFunction(() => !document.querySelector('button[data-id="serve"]').disabled, null, { timeout: 20000 })
  await dismiss(page)
}
const fbKind = page => page.locator('.panel .feedback').last().getAttribute('data-kind')

async function visionLevel(page) {
  await btn(page, 'play-vision').click()
  await page.waitForSelector('button[data-id="serve"]')
  // step 1: two pictures, then the question
  await serveOnce(page)
  ok('vision step1 camera views drawn', await page.evaluate(() => { const c = document.querySelector('.camview canvas'); return c.getContext('2d').getImageData(80, 60, 1, 1).data[3] === 255 }))
  await btn(page, 'which-0').click(); ok('vision step1 wrong answer', (await fbKind(page)) === 'bad')
  await btn(page, 'which-1').click(); await nextVisible(page); await btn(page, 'next').click()
  // step 2: colour width — too wide grabs the table, narrow loses it, medium passes
  await page.waitForSelector('button[data-id="width-30"]')
  await btn(page, 'width-30').click(); await serveOnce(page); ok('vision step2 wide fails', (await fbKind(page)) === 'bad')
  await btn(page, 'width-2').click(); await serveOnce(page); ok('vision step2 narrow fails', (await fbKind(page)) === 'bad')
  await btn(page, 'width-10').click(); await serveOnce(page); ok('vision step2 medium passes', (await fbKind(page)) === 'good')
  await nextVisible(page); await btn(page, 'next').click()
  // step 3: size vs depth
  await btn(page, 'mode-size').click(); await serveOnce(page); ok('vision step3 size fails', (await fbKind(page)) === 'bad')
  const sizeErr = parseFloat(await page.locator('[data-id=pos] .v').textContent())
  await btn(page, 'mode-depth').click(); await serveOnce(page); ok('vision step3 depth passes', (await fbKind(page)) === 'good')
  const depthErr = parseFloat(await page.locator('[data-id=pos] .v').textContent())
  ok('vision step3 depth ≪ size', depthErr < 3 && sizeErr > 15, `${depthErr} vs ${sizeErr}`)
  await nextVisible(page); await btn(page, 'next').click()
  // step 4: gap + bounce rule
  await btn(page, 'gap-12').click(); await serveOnce(page); ok('vision step4 gap 12 too late', (await fbKind(page)) === 'bad')
  await btn(page, 'gap-3').click(); await serveOnce(page); ok('vision step4 no bounce rule fails', (await fbKind(page)) === 'bad')
  await btn(page, 'bounce').click(); await serveOnce(page); ok('vision step4 gap 3 + bounce rule passes', (await fbKind(page)) === 'good')
  ok('vision step4 forecast readout', /^\d+$/.test((await page.locator('[data-id=ro-pred] .v').textContent()).trim()))
  await nextVisible(page); await btn(page, 'next').click()
  // step 5: the exam
  await btn(page, 'run').click()
  for (let i = 0; i < 12; i++) await page.evaluate(() => { const t = window.bb.tick; for (let k = 0; k < 200; k++) t(1 / 60) })
  await page.waitForFunction(() => !document.querySelector('button[data-id="run"]').disabled, null, { timeout: 60000 })
  await dismiss(page)
  ok('vision exam lists 10 serves', await page.locator('.examline').count() === 10)
  ok('vision exam passes', (await fbKind(page)) === 'good', await page.locator('.panel .feedback').last().textContent())
  await nextVisible(page); await btn(page, 'next').click()
  await btn(page, 'choice-1').click(); await nextVisible(page); await btn(page, 'next').click()
  await page.waitForSelector('button[data-id="to-hub"]'); await btn(page, 'to-hub').click()
  await page.reload({ waitUntil: 'commit' }); await page.waitForFunction(() => window.bb?.robot)
  ok('vision badge survives reload', (await page.locator('[data-level=vision] .progress').textContent()) === 'Badge earned')
  ok('hub order is stand → see → play', (await page.$$eval('.node', ns => ns.map(n => n.dataset.level).join(','))) === 'pid,vision,rl')
}

const closePopup = async page => { await page.waitForSelector('[data-modal=popup]', { timeout: 60000 }); await btn(page, 'popup-close').click() }

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
  // step 4: no exploration first → training learns nothing → back → yes
  await btn(page, 'explore-no').click(); await nextVisible(page); await btn(page, 'next').click()
  await btn(page, 'train').click(); await closePopup(page)
  ok('rl no-exploration learns nothing', await page.locator('.feedback.bad').count() === 1)
  await btn(page, 'to-explore').click(); await btn(page, 'explore-yes').click(); await btn(page, 'next').click()
  await btn(page, 'train').click(); await closePopup(page)
  const ep = await page.locator('[data-id=ep] .v').textContent()
  ok('rl trained 300', ep === '300/300', ep)
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bb-game-v1')).levels.rl)
  ok('rl policy persisted + curve', saved.policy && saved.preset === 'return' && saved.curve.length >= 10)
  await btn(page, 'next').click()
  // step 6: train 300 more, see the curve
  await btn(page, 'more').click(); await closePopup(page)
  ok('rl curve extended to 600', (await page.evaluate(() => JSON.parse(localStorage.getItem('bb-game-v1')).levels.rl.curve.at(-1).episodes)) === 600)
  await btn(page, 'next').click()
  // step 7: evaluate (arm tweens; fast-forward)
  await btn(page, 'run').click(); await btn(page, 'skip').click(); await closePopup(page)
  const al = +(await page.locator('[data-id=a-leg] .v').textContent()), bl = +(await page.locator('[data-id=b-leg] .v').textContent())
  ok('rl after > before on unseen serves', al > bl, `${bl} → ${al}`)
  await btn(page, 'next').click()
  await btn(page, 'choice-1').click(); await nextVisible(page); await btn(page, 'next').click()
  await page.waitForSelector('button[data-id="to-hub"]')
  await btn(page, 'real-game').click(); ok('rl real-game card', await page.locator('[data-modal=real-game] pre').count() === 1 && await btn(page, 'start-real-game').count() === 1); await btn(page, 'close-real-game').click()
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
    await page.evaluate(() => { const s = window.bb.state; s.levels.rl.step = 5; s.levels.rl.explore = true; s.levels.rl.preset = 'return'; localStorage.setItem('bb-game-v1', JSON.stringify(s)) })
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
