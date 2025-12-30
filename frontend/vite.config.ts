import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/',  // Custom domain (pkgrisk.com / pkgrisk.dev)
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
