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
    // NOTE: replayed ops will not have their original timestamps, so timestamp-related
    // test cases are not being tested properly.

    // "legacy" op tests are skipped because the server is not expected to accept them
    const valid_audit_logs = path.join(INTEROP_TESTS_DIR, 'audit_log', 'valid')
    for (const fileName of await fs.readdir(valid_audit_logs)) {
      if (fileName.includes('legacy')) continue
      const testPath = path.join(valid_audit_logs, fileName)
      const testcase: any[] = JSON.parse(await fs.readFile(testPath, 'utf8'))
      for (const entry of testcase) {
        await client.sendOperation(entry.did, entry.operation)
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
        await client.sendOperation(entry.did, entry.operation)
      }
    }

    for (const fileName of await fs.readdir(invalid_audit_logs)) {
      if (fileName.includes('too_slow')) continue // cannot test timestamp-related constraints for aforementioned reasons

      let res = replayTestCase(fileName)
      await expect(res).rejects.toThrow(PlcClientError) // NOTE: plc.Client returns opaque HTTP 400 errors, so we can't check in more detail
    }
  })
})
