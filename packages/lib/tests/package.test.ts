import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const libDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Depends on a prior build: `dist` must exist for the tarball to contain it.
describe('published tarball', () => {
  let packed: string[]

  beforeAll(() => {
    const out = execFileSync('pnpm', ['pack', '--dry-run', '--json'], {
      cwd: libDir,
      encoding: 'utf8',
    })
    const parsed = JSON.parse(out)
    packed = parsed.files.map((f: { path: string }) => f.path)
  })

  it('packs only dist, src, README, LICENSE and package.json', () => {
    const allowed =
      /^(dist\/.+|src\/.+\.ts|README\.md|LICENSE.*|package\.json)$/
    expect(packed.filter((p) => !allowed.test(p))).toEqual([])
  })

  it('packs the entrypoint and its types', () => {
    expect(packed).toContain('dist/index.js')
    expect(packed).toContain('dist/index.d.ts')
  })

  it('packs the sources that the source maps point at', () => {
    expect(packed).toContain('src/index.ts')
  })

  it('does not pack tests or tooling config', () => {
    const banned =
      /(^tests\/|^tsconfig.*\.json$|\.tsbuildinfo$|^vitest\.config\.ts$)/
    expect(packed.filter((p) => banned.test(p))).toEqual([])
  })
})
