// Bundle the Vercel serverless functions into SELF-CONTAINED files.
//
// WHY THIS EXISTS: the ranked API handlers import the pure sim + game data
// (server/verify-run.ts → ../src/game/ranked → ../sim → …). Those are
// extensionless ESM imports under `moduleResolution: bundler`, which Node's
// runtime ESM loader CANNOT resolve when a function ships unbundled — the live
// symptom was `ERR_MODULE_NOT_FOUND: Cannot find module '/var/task/src/game/
// ranked'` → FUNCTION_INVOCATION_FAILED. Vite bundles the CLIENT, but nothing
// bundled the api/ functions.
//
// So we bundle each handler ourselves with esbuild into a single file per route
// with ZERO external `../src` imports (only Node built-ins + global fetch). A
// self-contained function is robust no matter how Vercel packages it: whether it
// builds from the git snapshot or re-bundles our output, there is nothing left
// to resolve. Output lands in api/*.js (committed, regenerated every build) so
// exactly ONE file per route lives in api/ (no conflicting-function ambiguity).
//
// NOT minified on purpose: the server re-runs the SAME sim floats as the client;
// keep the math and stack traces byte-for-byte, only strip the module boundaries.

import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// route name → source handler. The route name IS the served path (/api/<name>).
const FUNCTIONS = [
  { entry: 'server/verify-run.ts', out: 'api/verify-run.js' },
  { entry: 'server/account.ts', out: 'api/account.js' },
]

for (const fn of FUNCTIONS) {
  await build({
    entryPoints: [resolve(root, fn.entry)],
    outfile: resolve(root, fn.out),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    // Inline EVERYTHING (src/ + any npm dep the sim pulls); esbuild keeps only
    // Node built-ins external for platform:node. Result: zero runtime resolution.
    logLevel: 'info',
  })
  console.log(`  api bundle: ${fn.entry} → ${fn.out}`)
}
