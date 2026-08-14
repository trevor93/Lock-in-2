import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './src/index.tsx',
      miniflare: {
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
  },
})
