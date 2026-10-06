import { defineConfig, loadEnv } from 'vite'
import path from 'path'

/**
 * Verified figures of the real test clients: `npm run figures:snapshot` and
 * `npm run figures:check` (scripts/figures/README.md).
 *
 * Everything they read and write lives in /verified-figures/, which is
 * gitignored — real client data never enters the repo. Only the snapshot
 * step reads the database (SELECTs only, with the app's .env); the check
 * replays the stored statements locally and needs no database.
 */
export default defineConfig(({ mode }) => ({
  test: {
    environment: 'node',
    include: ['scripts/figures/**/*.figures.ts'],
    env: loadEnv(mode, process.cwd(), ''),
    fileParallelism: false,
    testTimeout: 120_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
}))
