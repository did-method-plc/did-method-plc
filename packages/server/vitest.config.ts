import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['../../test-setup.ts'],
    testTimeout: 30_000,
    include: ['tests/**/*.{test,spec}.ts'],
  },
})
