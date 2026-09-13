import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

// Full-flow browser check against a running lab server (default: production build on 8080).
// Covers rendering, all three lesson flows, reload persistence, RL job resume/cancel, and mobile layout.
const baseURL = process.env.LAB_URL || 'http://127.0.0.1:8080'
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const output = '../artifacts/learning-lab-qa'
await mkdir(output, { recursive: true })

const browser = await chromium.launch({ headless: true, executablePath: chrome })
const errors = []
const steps = []
const watch = (page, tag) => {
  page.on('console', message => { if (message.type() === 'error') errors.push(`${tag} console: ${message.text()}`) })
  page.on('pageerror', error => errors.push(`${tag} page: ${error.message}`))
}
async function step(name, fn) {
  const started = Date.now()
  try { const detail = await fn(); steps.push({ name, ok: true, ms: Date.now() - started, ...(detail || {}) }) }
  catch (error) { steps.push({ name, ok: false, ms: Date.now() - started, error: error.message.split('\n')[0] }); errors.push(`step "${name}": ${error.message.split('\n')[0]}`) }
}
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
watch(page, 'desktop')
const shot = name => page.screenshot({ path: `${output}/${name}.png`, fullPage: true })
const runPid = async () => { await page.getByRole('button', { name: /run experiment/i }).click(); await page.getByRole('button', { name: /running mujoco/i }).waitFor({ state: 'hidden', timeout: 30000 }) }
const openLesson = async name => { const back = page.getByRole('button', { name: /lab map/i }); if (await back.isVisible()) await back.click(); await page.getByRole('button', { name }).click() }

let canvas = null, diagnostics = null
await step('home renders', async () => { await page.goto(baseURL, { waitUntil: 'networkidle' }); await shot('home-desktop') })

// ---- Lesson 01: PID ----------------------------------------------------------------------------
await step('pid: lazy 3D scene renders', async () => {
  await page.getByRole('button', { name: /keep it steady/i }).click()
  await page.locator('canvas').waitFor({ state: 'visible', timeout: 15000 })
  await shot('pid-desktop')
})
await step('pid: first experiment', async () => {
  await runPid(); await page.getByText(/cm max error/i).waitFor()
  canvas = await page.locator('canvas').evaluate(el => ({ cssWidth: el.clientWidth, cssHeight: el.clientHeight, bufferWidth: el.width, bufferHeight: el.height }))
  diagnostics = await page.evaluate(() => { const d = window.__THREE_GAME_DIAGNOSTICS__; return d ? { calls: d.renderer.render.calls, triangles: d.renderer.render.triangles, geometries: d.renderer.memory.geometries, textures: d.renderer.memory.textures, scene: d.scene } : null })
  await shot('pid-result-desktop')
  return { canvas, diagnostics }
})
await step('pid: challenge gate needs all three disturbances', async () => {
  await page.getByRole('button', { name: /^5\s*challenge/i }).click()
  const ranges = page.locator('input[type=range]')
  await ranges.nth(0).fill('3.2'); await ranges.nth(1).fill('1.1'); await ranges.nth(2).fill('0.35')
  const select = page.locator('select')
  await select.selectOption('push'); await runPid()
  if (await page.getByTestId('concept-check').isVisible()) throw new Error('concept check appeared after only one disturbance')
  await select.selectOption('long_push'); await runPid()
  await select.selectOption('steady_pull'); await runPid()
  const board = await page.getByTestId('challenge-board').innerText()
  if ((board.match(/✓/g) || []).length !== 3) throw new Error(`challenge board: ${board.replace(/\n/g, ' ')}`)
  await page.getByTestId('concept-check').waitFor()
  await page.getByRole('button', { name: /react to the error right now/ }).click()
  await page.getByText(/not quite/i).waitFor()
  await page.getByRole('button', { name: /add up small errors/ }).click()
  await page.getByText(/lesson complete/i).waitFor()
  await shot('pid-complete-desktop')
})

// ---- Lesson 03: Vision -------------------------------------------------------------------------
const truth = [...Array(6).fill('red'), ...Array(6).fill('blue'), ...Array(6).fill('yellow')]
await step('vision: label 18, train, test, improve, own color', async () => {
  await openLesson(/teach it colors/i)
  for (let i = 0; i < 18; i++) await page.getByLabel(`Label sample ${i + 1}`, { exact: true }).selectOption(truth[i])
  await page.getByText('18 labeled').waitFor()
  await page.getByRole('button', { name: /train classifier/i }).click()
  await page.getByText(/training fit/i).waitFor({ timeout: 20000 })
  await page.getByRole('button', { name: /reveal 12 tests/i }).click()
  await page.getByTestId('test-grid').waitFor({ timeout: 20000 })
  const predicted = await page.getByTestId('test-grid').locator('span').allInnerTexts()
  if (predicted.length !== 12) throw new Error(`expected 12 predictions, got ${predicted.length}`)
  await page.getByRole('button', { name: /next: improve/i }).click()
  await page.getByRole('button', { name: /add 6 \+ retrain/i }).click()
  await page.getByText(/improved set trained with 24 examples/i).waitFor({ timeout: 20000 })
  await page.getByRole('button', { name: /next: try your own/i }).click()
  await page.getByLabel('Choose a color').fill('#2f5fd0')
  await page.getByRole('button', { name: /ask the model/i }).click()
  const own = await page.getByTestId('own-prediction').innerText()
  if (!/^blue/i.test(own)) throw new Error(`expected blue prediction, got "${own}"`)
  await page.getByRole('button', { name: /add more labeled examples/i }).click()
  await page.getByText(/lesson complete/i).waitFor()
  await shot('vision-complete-desktop')
  return { predicted, own }
})
await step('vision: reload keeps labels, model and completion', async () => {
  await page.reload({ waitUntil: 'networkidle' })
  const card = await page.getByRole('button', { name: /teach it colors/i }).innerText()
  if (!/complete/i.test(card)) throw new Error(`vision card after reload: ${card.replace(/\n/g, ' ')}`)
  await page.getByRole('button', { name: /teach it colors/i }).click()
  await page.getByText('18 labeled').waitFor()
  if (await page.getByRole('button', { name: /^ask the model$/i }).isDisabled()) throw new Error('model was not restored after reload')
})

// ---- Lesson 02: RL -----------------------------------------------------------------------------
await step('rl: task, sorting and reward stages', async () => {
  await openLesson(/teach a return/i)
  await page.getByRole('button', { name: /land on the far side/i }).click()
  for (const item of ['Ball position', 'Ball speed', 'Arm angles']) await page.getByRole('button', { name: item }).click()
  await page.getByRole('button', { name: 'Move arm joints' }).click(); await page.getByRole('button', { name: 'Move arm joints' }).click()
  await page.getByRole('button', { name: /check my sort/i }).click()
  await page.getByText(/^Exactly/).waitFor()
  await page.getByRole('button', { name: /next: design rewards/i }).click()
  await page.getByRole('button', { name: /use this reward/i }).click()
  await page.getByText(/training progress/i).waitFor()
})
await step('rl: stop training from the UI', async () => {
  await page.getByRole('button', { name: /continue training/i }).click()
  await page.getByRole('button', { name: /stop training/i }).click()
  await page.getByText(/training stopped early/i).waitFor({ timeout: 20000 })
})
await step('rl: reload resumes a running job and completes it', async () => {
  await page.getByRole('button', { name: /continue training/i }).click()
  await page.getByText(/practicing/i).waitFor()
  await page.waitForTimeout(1500)
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /teach a return/i }).click()
  // The lesson asks the server for its newest job on mount; give that request a moment to land.
  await page.getByTestId('training-steps').filter({ hasNotText: 'READY' }).waitFor({ timeout: 5000 }).catch(() => { throw new Error('running job was not resumed after reload') })
  const readout = await page.getByTestId('training-steps').innerText()
  await page.getByTestId('scoreboard-your-model').waitFor({ timeout: 120000 })
  await shot('rl-student-desktop')
  return { readoutAfterReload: readout, student: await page.getByTestId('scoreboard-your-model').innerText() }
})
await step('rl: reference evaluation and concept check', async () => {
  await page.getByRole('button', { name: /test reference policy/i }).click()
  await page.getByTestId('scoreboard-reference-model').waitFor({ timeout: 120000 })
  await page.getByRole('button', { name: /check it learned the skill/i }).click()
  await page.getByText(/lesson complete/i).waitFor()
  await shot('rl-complete-desktop')
  await page.getByRole('button', { name: /lab map/i }).click()
  const cards = await page.locator('.lesson-card').allInnerTexts()
  if (cards.filter(c => /complete/i.test(c)).length !== 3) throw new Error(`expected 3 complete cards: ${cards.map(c => c.replace(/\n/g, ' ')).join(' | ')}`)
  await shot('home-complete-desktop')
})

// ---- Mobile ------------------------------------------------------------------------------------
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
watch(mobile, 'mobile')
await step('mobile: home and vision without horizontal scroll', async () => {
  await mobile.goto(baseURL, { waitUntil: 'networkidle' })
  await mobile.screenshot({ path: `${output}/home-mobile.png`, fullPage: true })
  await mobile.getByRole('button', { name: /teach it colors/i }).click()
  await mobile.screenshot({ path: `${output}/vision-mobile.png`, fullPage: true })
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  if (overflow > 0) throw new Error(`page overflows horizontally by ${overflow}px`)
  return { overflow }
})

const report = { baseURL, checkedAt: new Date().toISOString(), errors, canvas, diagnostics, steps, passed: errors.length === 0 && canvas?.cssWidth > 0 && canvas?.cssHeight > 0 && diagnostics?.triangles > 0 && steps.every(s => s.ok) }
await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
await browser.close()
console.log(JSON.stringify(report, null, 2))
if (!report.passed) process.exit(1)
