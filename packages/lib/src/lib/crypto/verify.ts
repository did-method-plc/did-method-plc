import { parseDidKey } from './did.js'
import { plugins } from './plugins.js'
import type { VerifyOptions } from './plugins/types.ts'

export const verifySignature = (
  didKey: string,
  data: Uint8Array,
  sig: Uint8Array,
  opts?: VerifyOptions & {
    jwtAlg?: string
  },
): Promise<boolean> => {
  const parsed = parseDidKey(didKey)
  if (opts?.jwtAlg && opts.jwtAlg !== parsed.jwtAlg) {
    throw new Error(`Expected key alg ${opts.jwtAlg}, got ${parsed.jwtAlg}`)
  }
  const plugin = plugins.find((p) => p.jwtAlg === parsed.jwtAlg)
  if (!plugin) {
    throw new Error(`Unsupported signature alg: ${parsed.jwtAlg}`)
  }
  return plugin.verifySignature(didKey, data, sig, opts)
}
