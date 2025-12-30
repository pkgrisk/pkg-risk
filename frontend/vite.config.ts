import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Use '/pkg-risk/' for GitHub Pages subdomain
  // Once pkgrisk.com DNS is configured, set VITE_BASE_URL=/
  base: process.env.VITE_BASE_URL || '/pkg-risk/',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
