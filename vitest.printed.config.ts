import { defineConfig } from 'vite'
import path from 'path'

/**
 * The as-printed regression (scripts/printed/README.md): `npm run printed:dump`
 * and `npm run printed:check`. Reads the real clients' PDFs and expected rows
 * from /verified-figures/ (gitignored): real client data never enters the
 * repo. Needs no database.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/printed/**/*.printed.ts'],
    fileParallelism: false,
    testTimeout: 300_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
