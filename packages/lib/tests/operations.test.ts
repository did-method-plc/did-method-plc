import { beforeAll, describe, expect, it } from 'vitest'
import { P256Keypair, Secp256k1Keypair } from '@atproto/crypto'
import * as operations from '../src/operations.js'

describe('atproto operation helpers', () => {
  let signingKey: Secp256k1Keypair
  let kemKey: P256Keypair
  let otherKey: P256Keypair
  let rotationKey: Secp256k1Keypair

  beforeAll(async () => {
    signingKey = await Secp256k1Keypair.create()
    kemKey = await P256Keypair.create()
    otherKey = await P256Keypair.create()
    rotationKey = await Secp256k1Keypair.create()
  })

  const base = () => ({
    signingKey: signingKey.did(),
    handle: 'alice.example.com',
    pds: 'https://example.com',
    rotationKeys: [rotationKey.did()],
  })

  describe('formatAtprotoOp', () => {
    it('writes only the atproto signing key by default', () => {
      const op = operations.formatAtprotoOp({ ...base(), prev: null })
      expect(op.verificationMethods).toEqual({ atproto: signingKey.did() })
    })

    it('writes kemKey to atproto_kem', () => {
      const op = operations.formatAtprotoOp({
        ...base(),
        kemKey: kemKey.did(),
        prev: null,
      })
      expect(op.verificationMethods).toEqual({
        atproto: signingKey.did(),
        atproto_kem: kemKey.did(),
      })
    })

    it('writes extra verification methods alongside the atproto keys', () => {
      const op = operations.formatAtprotoOp({
        ...base(),
        kemKey: kemKey.did(),
        verificationMethods: { other: otherKey.did() },
        prev: null,
      })
      expect(op.verificationMethods).toEqual({
        atproto: signingKey.did(),
        atproto_kem: kemKey.did(),
        other: otherKey.did(),
      })
    })

    it('refuses extra verification methods that collide with signingKey', () => {
      expect(() =>
        operations.formatAtprotoOp({
          ...base(),
          verificationMethods: { atproto: otherKey.did() },
          prev: null,
        }),
      ).toThrow(/atproto/)
    })

    it('refuses extra verification methods that collide with kemKey', () => {
      expect(() =>
        operations.formatAtprotoOp({
          ...base(),
          kemKey: kemKey.did(),
          verificationMethods: { atproto_kem: otherKey.did() },
          prev: null,
        }),
      ).toThrow(/atproto_kem/)
    })

    it('accepts atproto_kem through extra verification methods alone', () => {
      const op = operations.formatAtprotoOp({
        ...base(),
        verificationMethods: { atproto_kem: kemKey.did() },
        prev: null,
      })
      expect(op.verificationMethods).toEqual({
        atproto: signingKey.did(),
        atproto_kem: kemKey.did(),
      })
    })
  })

  describe('createOp', () => {
    it('signs a valid genesis op carrying the kem key', async () => {
      const { op, did } = await operations.createOp({
        ...base(),
        kemKey: kemKey.did(),
        signer: rotationKey,
      })
      expect(op.verificationMethods).toEqual({
        atproto: signingKey.did(),
        atproto_kem: kemKey.did(),
      })
      const data = await operations.assureValidCreationOp(did, op)
      expect(data.verificationMethods.atproto_kem).toEqual(kemKey.did())
    })

    it('passes kemKey through atprotoOp', async () => {
      const op = await operations.atprotoOp({
        ...base(),
        kemKey: kemKey.did(),
        verificationMethods: { other: otherKey.did() },
        prev: null,
        signer: rotationKey,
      })
      expect(op.verificationMethods).toEqual({
        atproto: signingKey.did(),
        atproto_kem: kemKey.did(),
        other: otherKey.did(),
      })
    })
  })

  describe('createAtprotoUpdateOp', () => {
    const genesis = async () =>
      operations.atprotoOp({
        ...base(),
        verificationMethods: { other: otherKey.did() },
        prev: null,
        signer: rotationKey,
      })

    it('adds a kem key while preserving other verification methods', async () => {
      const update = await operations.createAtprotoUpdateOp(
        await genesis(),
        rotationKey,
        { kemKey: kemKey.did() },
      )
      expect(update.verificationMethods).toEqual({
        atproto: signingKey.did(),
        atproto_kem: kemKey.did(),
        other: otherKey.did(),
      })
    })

    it('preserves the kem key when rotating the signing key', async () => {
      const withKem = await operations.createAtprotoUpdateOp(
        await genesis(),
        rotationKey,
        { kemKey: kemKey.did() },
      )
      const newSigningKey = await Secp256k1Keypair.create()
      const update = await operations.createAtprotoUpdateOp(
        withKem,
        rotationKey,
        { signingKey: newSigningKey.did() },
      )
      expect(update.verificationMethods).toEqual({
        atproto: newSigningKey.did(),
        atproto_kem: kemKey.did(),
        other: otherKey.did(),
      })
    })

    it('merges extra verification methods over existing ones', async () => {
      const replacement = await P256Keypair.create()
      const update = await operations.createAtprotoUpdateOp(
        await genesis(),
        rotationKey,
        { verificationMethods: { other: replacement.did() } },
      )
      expect(update.verificationMethods).toEqual({
        atproto: signingKey.did(),
        other: replacement.did(),
      })
    })

    it('refuses extra verification methods that collide with kemKey', async () => {
      await expect(
        operations.createAtprotoUpdateOp(await genesis(), rotationKey, {
          kemKey: kemKey.did(),
          verificationMethods: { atproto_kem: otherKey.did() },
        }),
      ).rejects.toThrow(/atproto_kem/)
    })
  })
})
