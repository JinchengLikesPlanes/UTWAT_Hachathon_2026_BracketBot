import { STR } from './strings.js'
import { loadState } from './state.js'

const state = loadState()
const ui = document.getElementById('ui')
ui.textContent = `${STR.app.title} — ${STR.hub.progress.replace('{n}', state.levels.pid.step)}`
