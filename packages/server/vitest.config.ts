import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['../../test-setup.ts'],
    testTimeout: 30_000,
    include: ['tests/**/*.{test,spec}.ts'],
  },
})
