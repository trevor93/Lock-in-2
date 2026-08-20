import { defineConfig } from 'vitest/config'

// DOM-side unit tests (morph.js) run under happy-dom in plain Node, separate
// from the Cloudflare Workers pool that backs the server tests. Keeping them in
// their own project means the workers runtime and the DOM runtime never collide.
export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['test/**/*.dom.test.ts'],
  },
})
