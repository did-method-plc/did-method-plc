import * as plc from '@did-plc/lib'
import { CloseFn, runTestServer } from './_util'
import { Database } from '../src'
import { PlcClientError } from '@did-plc/lib'
import * as fs from 'fs/promises'
import * as path from 'path'

describe('interop', () => {
  let close: CloseFn
  let db: Database
  let client: plc.Client

  const INTEROP_TESTS_DIR = path.join(
    __dirname,
    '..',
    '..',
    '..',
    'interop_tests',
  )

  beforeAll(async () => {
    const server = await runTestServer({
      dbSchema: 'server',
    })

    db = server.db
    close = server.close
    client = new plc.Client(server.url)
  })

  afterAll(async () => {
    if (close) {
      await close()
    }
  })

  it('accepts replayed valid interop test logs', async () => {
    // Note: "legacy" op tests are skipped here because the server is not expected to accept them
    const valid_audit_logs = path.join(INTEROP_TESTS_DIR, 'audit_log', 'valid')
    for (const fileName of await fs.readdir(valid_audit_logs)) {
      if (fileName.includes('legacy')) continue
      const testPath = path.join(valid_audit_logs, fileName)
      const testcase: any[] = JSON.parse(await fs.readFile(testPath, 'utf8'))
      for (const entry of testcase) {
        await db.validateAndAddOp(
          entry.did,
          entry.operation,
          new Date(entry.createdAt),
        )
      }
    }
  })

  it('rejects replayed invalid interop test logs', async () => {
    const invalid_audit_logs = path.join(
      INTEROP_TESTS_DIR,
      'audit_log',
      'invalid',
    )

    async function replayTestCase(fileName: string) {
      const testPath = path.join(invalid_audit_logs, fileName)
      const testcase: any[] = JSON.parse(await fs.readFile(testPath, 'utf8'))
      for (const entry of testcase) {
        // we submit to the db directly so we can specify the timestamp (and get
        // more detailed errors)
        await db.validateAndAddOp(
          entry.did,
          entry.operation,
          new Date(entry.createdAt),
        )
      }
    }

    await expect(
      replayTestCase('log_invalid_nullification_reused_key.json'),
    ).rejects.toThrowError(/Invalid signature on op/)

    await expect(
      replayTestCase('log_invalid_nullification_too_slow.json'),
    ).rejects.toThrowError(
      /Recovery operation occurred outside of the allowed 72 hr recovery window/,
    )

    await expect(
      replayTestCase('log_invalid_sig_b64_newline.json'),
    ).rejects.toThrowError('Non-base64url character')

    await expect(
      replayTestCase('log_invalid_sig_b64_padding_bits.json'),
    ).rejects.toThrowError('Unexpected end of data')

    await expect(
      replayTestCase('log_invalid_sig_b64_padding_chars.json'),
    ).rejects.toThrowError(/Invalid signature on op/)

    await expect(
      replayTestCase('log_invalid_sig_der.json'),
    ).rejects.toThrowError(/Invalid signature on op/)

    await expect(
      replayTestCase('log_invalid_sig_k256_high_s.json'),
    ).rejects.toThrowError(/Invalid signature on op/)

    await expect(
      replayTestCase('log_invalid_sig_p256_high_s.json'),
    ).rejects.toThrowError(/Invalid signature on op/)

    await expect(
      replayTestCase('log_invalid_update_nullified.json'),
    ).rejects.toThrowError('Operations not correctly ordered')

    await expect(
      replayTestCase('log_invalid_update_tombstoned.json'),
    ).rejects.toThrowError('Operations not correctly ordered')
  })
})
