import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['../../test-setup.ts'],
    testTimeout: 30_000,
    include: ['tests/**/*.{test,spec}.ts'],
    // Provisional: a pre-existing timing race flakes this suite
    // (recovery.test.ts "allows recovery from a tombstoned DID" -
    // same-millisecond timestamp collision, ~1 run in 5-8).
    // Retries keep CI legible until that race is fixed properly.
    // Remove this once it is.
    retry: 2,
  },
})
