import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/pkg-risk/',  // GitHub Pages repo name
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
