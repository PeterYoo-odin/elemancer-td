import { defineConfig } from 'vite'

// base: './' keeps asset paths relative so the same build works on Vercel AND
// when zipped for web-game portals (CrazyGames / Poki) later.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
  server: {
    host: true,
  },
})
