import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The pi bridge server (server/index.mjs) runs on :5178; /api is proxied there
// so the browser sees a same-origin API — no CORS needed.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:5178', changeOrigin: false },
    },
  },
})
