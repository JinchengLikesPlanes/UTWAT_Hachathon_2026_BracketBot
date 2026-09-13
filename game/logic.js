// Platform stub for a solo game (required by the deploy target; the game itself is client-only).
export const meta = { game: 'bracketbot-robotics', minPlayers: 1, maxPlayers: 1 }
export function setup() { return {} }
export function validateAction() { return { ok: true } }
export function applyAction(state) { return state }
export function isGameOver() { return { over: false } }
export function viewFor(state) { return state }
