import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // The component tests drive real user-event interactions against jsdom,
    // which is legitimately slow — a leads row alone renders two selects with
    // ten options each, twice over for the table and the mobile card. The 5s
    // default made them flaky under parallel load rather than catching a hang.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    pool: 'vmThreads',
    coverage: {
      reporter: ['text', 'lcov'],
      include: ['src/lib/**', 'src/components/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
