import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: ['packages/lib', 'packages/server'],
    setupFiles: ['./test-setup.ts'],
    testTimeout: 30_000,
    include: ['tests/**/*.{test,spec}.ts'],
  },
})
