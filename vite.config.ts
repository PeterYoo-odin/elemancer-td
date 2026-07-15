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
      output: {
        // Vendor-split the two engine dependencies into their OWN cache-stable
        // chunks. Game code changes every deploy; Phaser/Three change ~never —
        // without this, every deploy forced returning players to re-download
        // ~1.4 MB of minified Phaser bundled inside the 2 MB main chunk. With
        // it, main shrinks to the game's own code, the engine chunks download
        // in parallel on cold load (HTTP/2), and repeat visits hit the HTTP
        // cache for both engines. (three stays lazy — only the battle chunk
        // references it, so the menu still never downloads it.)
        manualChunks(id: string) {
          if (id.includes('node_modules/phaser')) return 'phaser'
          if (id.includes('node_modules/three')) return 'three'
        },
      },
    },
  },
  server: {
    host: true,
  },
})
