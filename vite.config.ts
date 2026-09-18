import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // strictPort: lieber ein klarer Fehler als ein stiller Fallback-Port.
  server: {
    port: 5180,
    strictPort: true,
    open: true,
    // Im Dev-Modus laeuft der API-Server daneben (pnpm dev:server).
    proxy: { '/api': 'http://localhost:3000' },
  },
})
