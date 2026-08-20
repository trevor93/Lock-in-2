import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './src/index.tsx',
      miniflare: {
        // Pinned to wrangler.jsonc so tests run against the same runtime
        // semantics as production instead of the current calendar date.
        compatibilityDate: '2026-04-26',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: ['DB'],
        bindings: {
          OPENAI_API_KEY: '',
          OPENAI_BASE_URL: 'https://model.invalid',
        },
      },
    }),
  ],
  test: {
    globals: true,
    setupFiles: ['./test/setup.ts'],
    // DOM tests run under happy-dom in vitest.dom.config.ts, not the workers pool.
    exclude: ['**/node_modules/**', '**/*.dom.test.ts'],
  },
})
