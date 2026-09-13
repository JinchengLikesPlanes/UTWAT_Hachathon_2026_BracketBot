import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8080', '/robot-assets': 'http://127.0.0.1:8080' } },
  // Three.js is split into its own lazily loaded chunk (~520 kB minified); the app shell stays ~250 kB.
  build: { chunkSizeWarningLimit: 600 },
})
