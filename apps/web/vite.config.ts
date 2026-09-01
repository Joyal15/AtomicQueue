import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Dev-only: makes relative /api/... fetches (apps/web/src/lib/api.ts) reach the
    // Express backend without a VITE_API_URL env var — matches true same-origin
    // production serving (architecture doc Section 14) without needing Vite to also
    // serve the API in dev. Update the target if the backend's PORT is overridden.
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
})
