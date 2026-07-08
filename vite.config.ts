import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// base: './' keeps asset paths relative so the same build works on Vercel AND
// when zipped for web-game portals (CrazyGames / Poki) later.
// Three pages: the game at / (seed deep-links keep working), the marketing
// landing at /landing, and the auth-gated admin/ops dashboard at /admin
// (vercel.json rewrites the clean paths). A separate admin entry keeps ALL
// admin code out of the players' game bundle — main.ts never imports src/admin.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        landing: fileURLToPath(new URL('./landing.html', import.meta.url)),
        admin: fileURLToPath(new URL('./admin.html', import.meta.url)),
      },
    },
  },
  server: {
    host: true,
  },
})
