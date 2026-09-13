// Progress persistence. Everything the player earns lives here; storage failures never throw.
export const STORAGE_KEY = 'bb-game-v1'
const VERSION = 1

export function defaultState() {
  return {
    version: VERSION,
    levels: {
      pid: { step: 1, done: false, gains: { kp: 0, ki: 0, kd: 0 }, examFails: 0 },
      rl: { step: 1, done: false, preset: 'contact', policy: null },
      vision: { step: 1, done: false, width: 30, mode: null, gap: 1, bounceRule: false },
    },
  }
}

export function loadState() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return defaultState()
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.version !== VERSION || !parsed.levels) return defaultState()
    // Fill any keys added after the save was written.
    const base = defaultState()
    for (const k of Object.keys(base.levels)) base.levels[k] = { ...base.levels[k], ...(parsed.levels[k] ?? {}) }
    return base
  } catch {
    return defaultState()
  }
}

export function saveState(state) {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* storage blocked */ }
}

export function resetState() {
  try { globalThis.localStorage?.removeItem(STORAGE_KEY) } catch { /* storage blocked */ }
}
