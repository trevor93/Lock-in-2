import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// Book 7 — client bundle. The frontend used to ship as nine <script> tags of
// globals; it is now an ES-module graph under public/static/app/ (core/ +
// features/) bundled here into one file the shell loads. Rollup resolves every
// import at build time, so a missing or misspelled import fails the build
// instead of becoming a runtime ReferenceError in the browser.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'public/static',
    emptyOutDir: false,
    // axios is provided by the CDN <script> as a global; keep it external.
    rollupOptions: {
      input: resolve(__dirname, 'public/static/app/main.js'),
      external: ['axios'],
      output: {
        format: 'iife',
        entryFileNames: 'bundle.js',
        inlineDynamicImports: true,
        globals: { axios: 'axios' },
      },
    },
    minify: false,      // keep the shipped bundle readable/auditable
    sourcemap: false,
    target: 'es2020',
  },
})
