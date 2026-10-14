import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The application is served by the harness. `BENCH_ORIGINS_URL` is set by
// `bench/dev.js` so the Vite dev server can proxy the seeded fixture
// endpoints; the benchmark itself fulfils the same endpoints in-page.
const originsUrl = process.env.BENCH_ORIGINS_URL

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '.cache/dist',
    emptyOutDir: true,
  },
  server: originsUrl
    ? {
        proxy: {
          '/api': { target: originsUrl, changeOrigin: true },
        },
      }
    : undefined,
})
