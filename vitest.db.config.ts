import { defineConfig, loadEnv } from 'vite'
import path from 'path'

/**
 * Database tests: `npm run test:db`.
 *
 * These run against a real Supabase project and write (then delete) synthetic
 * rows, so they only read the SUPABASE_TEST_* variables — never the app's own
 * NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Pointing them at a
 * project is a deliberate act, and they must never be pointed at production.
 * With the variables unset, every test is skipped.
 */
export default defineConfig(({ mode }) => ({
  test: {
    environment: 'node',
    include: ['supabase/tests/**/*.test.ts'],
    env: loadEnv(mode, process.cwd(), 'SUPABASE_TEST_'),
    // One file, run in order: later cases build on the rows earlier ones made.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
}))
