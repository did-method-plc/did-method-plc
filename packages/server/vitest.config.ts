import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['../../test-setup.ts'],
    testTimeout: 30_000,
    include: ['tests/**/*.{test,spec}.ts'],
    // Provisional: a pre-existing timing race flakes this suite
    // (sequencer.test.ts "handles many concurrent connections" -
    // producer/consumer timing race in the test's own logic, ~2 runs in 6).
    // Retries keep CI legible until that race is fixed properly.
    // Remove this once it is.
    retry: 2,
  },
})
