import { cidForCbor, DAY } from '@atproto/common'
import { Secp256k1Keypair } from '@atproto/crypto'
import {
  assureValidNextOp,
  CreateOpV1,
  deprecatedSignCreate,
  didForCreateOp,
  normalizeOp,
  updateRotationKeysOp,
  updateAtprotoKeyOp,
  validateOperationLog,
} from '../src'

describe('compatibility', () => {
  let signingKey: Secp256k1Keypair
  let recoveryKey: Secp256k1Keypair
  const handle = 'alice.test'
  const service = 'https://example.com'
  let did: string

  let legacyOp: CreateOpV1

  beforeAll(async () => {
    signingKey = await Secp256k1Keypair.create()
    recoveryKey = await Secp256k1Keypair.create()
  })

  it('normalizes legacy create ops', async () => {
    legacyOp = await deprecatedSignCreate(
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

    did = await didForCreateOp(legacyOp)

    const normalized = normalizeOp(legacyOp)
    expect(normalized).toEqual({
      type: 'plc_operation',
      verificationMethods: {
        atproto: signingKey.did(),
      },
      rotationKeys: [recoveryKey.did(), signingKey.did()],
      alsoKnownAs: [`at://${handle}`],
      services: {
        atproto_pds: {
          type: 'AtprotoPersonalDataServer',
          endpoint: service,
        },
      },
      prev: null,
      sig: legacyOp.sig,
    })
  })

  it('validates a log with a legacy create op', async () => {
    const legacyCid = await cidForCbor(legacyOp)
    const newSigner = await Secp256k1Keypair.create()
    const newRotater = await Secp256k1Keypair.create()
    const nextOp = await updateAtprotoKeyOp(
      legacyOp,
      signingKey,
      newSigner.did(),
    )
    const anotherOp = await updateRotationKeysOp(nextOp, signingKey, [
      newRotater.did(),
    ])
    await validateOperationLog(did, [legacyOp, nextOp])
    await validateOperationLog(did, [legacyOp, nextOp, anotherOp])

    const indexedLegacy = {
      did,
      operation: legacyOp,
      cid: legacyCid,
      nullified: false,
      createdAt: new Date(Date.now() - 7 * DAY),
    }

    const result = await assureValidNextOp(did, [indexedLegacy], nextOp)
    expect(result.nullified.length).toBe(0)
    expect(result.prev?.equals(legacyCid)).toBeTruthy()
  })
})
