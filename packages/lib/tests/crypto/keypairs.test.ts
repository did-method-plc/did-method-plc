// Adapted from `@atproto/crypto` (packages/crypto/tests/keypairs.test.ts).
// Signature verification goes through the public `verifySignature` helper
// rather than the per-curve `verifyDidSig` (which is internal here).
import { randomBytes } from '@noble/hashes/utils.js'
import { describe, expect, it } from 'vitest'
import { P256Keypair, Secp256k1Keypair } from '../../src/lib/crypto/plugins.ts'
import { verifySignature } from '../../src/lib/crypto/verify.ts'

describe('keypairs', () => {
  describe('secp256k1', () => {
    const keypair = Secp256k1Keypair.create()

    it('produces a valid signature', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const sig = await keypair.sign(data)

      const validSig = await verifySignature(keypair.did(), data, sig)

      expect(validSig).toBeTruthy()
    })

    it('produces a valid signature on a typed array of a large arraybuffer', async () => {
      const bytes = randomBytes(8192)
      const sliceView = new Uint8Array(bytes.buffer, 1024, 1024)
      expect(sliceView.buffer.byteLength).toBe(8192)
      const sig = await keypair.sign(sliceView)
      const validSig = await verifySignature(keypair.did(), sliceView, sig)
      expect(validSig).toBeTruthy()
    })
  })

  describe('P-256', () => {
    const keypair = P256Keypair.create()

    it('produces a valid signature', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const sig = await keypair.sign(data)

      const validSig = await verifySignature(keypair.did(), data, sig)

      expect(validSig).toBeTruthy()
    })

    it('produces a valid signature on a typed array of a large arraybuffer', async () => {
      const bytes = randomBytes(8192)
      const sliceView = new Uint8Array(bytes.buffer, 1024, 1024)
      expect(sliceView.buffer.byteLength).toBe(8192)
      const sig = await keypair.sign(sliceView)
      const validSig = await verifySignature(keypair.did(), sliceView, sig)
      expect(validSig).toBeTruthy()
    })
  })
})
