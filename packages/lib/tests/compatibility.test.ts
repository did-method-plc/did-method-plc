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
import * as fs from 'fs/promises'
import * as path from 'path'

describe('compatibility', () => {
  let signingKey: Secp256k1Keypair
  let recoveryKey: Secp256k1Keypair
  const handle = 'alice.test'
  const service = 'https://example.com'
  let did: string

  let legacyOp: CreateOpV1

  const INTEROP_TESTS_DIR = path.join(
    __dirname,
    '..',
    '..',
    '..',
    'interop_tests',
  )

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

  it('validates valid interop test logs', async () => {
    // NOTE: validateOperationLog looks at the ops themselves and thus does not
    // validate timestamp-related constraints
    const valid_audit_logs = path.join(INTEROP_TESTS_DIR, 'audit_log', 'valid')
    for (const fileName of await fs.readdir(valid_audit_logs)) {
      if (fileName.includes('nullif')) continue // validateOperationLog does not handle nullifications
      const testPath = path.join(valid_audit_logs, fileName)
      const testcase = JSON.parse(await fs.readFile(testPath, 'utf8'))
      const ops = testcase.map((logItem) => logItem.operation)
      await validateOperationLog(testcase[0].did, ops)
    }
  })

  it('does not validate invalid interop test logs', async () => {
    // NOTE: nullification-related test cases are not checked

    const invalid_audit_logs = path.join(
      INTEROP_TESTS_DIR,
      'audit_log',
      'invalid',
    )

    async function validateLogForPath(fileName: string) {
      const testPath = path.join(invalid_audit_logs, fileName)
      const testcase = JSON.parse(await fs.readFile(testPath, 'utf8'))
      const ops = testcase.map((logItem) => logItem.operation)
      await validateOperationLog(testcase[0].did, ops)
    }

    await expect(
      validateLogForPath('log_invalid_sig_b64_newline.json'),
    ).rejects.toThrowError('Non-base64url character')

    await expect(
      validateLogForPath('log_invalid_sig_b64_padding_bits.json'),
    ).rejects.toThrowError('Unexpected end of data')

    await expect(
      validateLogForPath('log_invalid_sig_b64_padding_chars.json'),
    ).rejects.toThrowError(/Invalid signature on op/) // afaict this is failing for the correct reasons

    await expect(
      validateLogForPath('log_invalid_sig_der.json'),
    ).rejects.toThrowError(/Invalid signature on op/)

    await expect(
      validateLogForPath('log_invalid_sig_k256_high_s.json'),
    ).rejects.toThrowError(/Invalid signature on op/)

    await expect(
      validateLogForPath('log_invalid_sig_p256_high_s.json'),
    ).rejects.toThrowError(/Invalid signature on op/)

    await expect(
      validateLogForPath('log_invalid_update_tombstoned.json'),
    ).rejects.toThrowError('Operations not correctly ordered')
  })
})
