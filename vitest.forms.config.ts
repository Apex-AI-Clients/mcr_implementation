import { defineConfig } from 'vite'
import path from 'path'

/**
 * Render tests for the official ASIC forms (src/lib/forms/__tests__/*.render.ts):
 * `npm run forms:check`, and `npm run forms:snapshot` to approve new
 * snapshots. Kept out of `npm run test` because rendering every page takes a
 * while and needs the native canvas. Synthetic data only.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/lib/forms/__tests__/**/*.render.ts'],
    testTimeout: 300_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
