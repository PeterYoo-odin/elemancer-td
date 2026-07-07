import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// base: './' keeps asset paths relative so the same build works on Vercel AND
// when zipped for web-game portals (CrazyGames / Poki) later.
// Two pages: the game at / (seed deep-links keep working) and the marketing
// landing at /landing (vercel.json rewrites the clean path to landing.html).
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        landing: fileURLToPath(new URL('./landing.html', import.meta.url)),
      },
    },
  },
  server: {
    host: true,
  },
})
