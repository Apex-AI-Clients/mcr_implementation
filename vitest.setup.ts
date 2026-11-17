import { vi } from 'vitest'

/**
 * Runs before each test file. A file mocks shared modules (next/navigation,
 * the Supabase server client, the OpenRouter client) with its own spies; in a
 * single worker (`--maxWorkers=1`, used on low-memory machines) the modules
 * under test could stay cached from an earlier file, bound to that file's
 * mocks, and fail only when run after it. Each file now loads its modules
 * fresh, bound to its own mocks.
 */
vi.resetModules()
