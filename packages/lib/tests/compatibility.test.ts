import { EcdsaKeypair, Secp256k1Keypair } from '@atproto/crypto'
import { deprecatedSignCreate, normalizeOp } from '../src'

describe('compatibility', () => {
  it('normalizes legacy create ops', async () => {
    const signingKey = await Secp256k1Keypair.create()
    const recoveryKey = await EcdsaKeypair.create()
    const handle = 'alice.test'
    const service = 'https://example.com'
    const legacy = await deprecatedSignCreate(
      {
        type: 'create',
        signingKey: signingKey.did(),
        recoveryKey: recoveryKey.did(),
        handle,
        service,
        prev: null,
      },
      signingKey,
    )

    const normalized = normalizeOp(legacy)
    expect(normalized).toEqual({
      signingKey: signingKey.did(),
      rotationKeys: [recoveryKey.did(), signingKey.did()],
      handles: [handle],
      services: {
        atpPds: service,
      },
      prev: null,
      sig: legacy.sig,
    })
  })
})
