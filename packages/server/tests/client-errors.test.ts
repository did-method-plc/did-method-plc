import axios from 'axios'
import { CloseFn, runTestServer } from './_util'

describe('client errors', () => {
  let close: CloseFn
  let url: string

  beforeAll(async () => {
    const server = await runTestServer({ dbSchema: 'client_errors' })
    close = server.close
    url = server.url
  })

  afterAll(async () => {
    if (close) await close()
  })

  const get = (path: string) =>
    axios.get(`${url}${path}`, { validateStatus: () => true })

  const post = (path: string, body: unknown) =>
    axios.post(`${url}${path}`, body, { validateStatus: () => true })

  const badDid = 'did:web:example.com'
  const unknownDid = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'

  const cases: Array<[string, number]> = [
    [`/${badDid}`, 400],
    [`/${badDid}/data`, 400],
    [`/${badDid}/log`, 400],
    [`/${badDid}/log/audit`, 400],
    [`/${badDid}/log/last`, 400],
    [`/${unknownDid}`, 404],
    [`/${unknownDid}/log/last`, 404],
    ['/export?count=0', 400],
    ['/export?after=not-a-date', 400],
    ['/export/stream', 426],
  ]

  for (const [path, status] of cases) {
    it(`GET ${path} responds ${status}`, async () => {
      const res = await get(path)
      expect(res.status).toEqual(status)
      expect(typeof res.data.message).toEqual('string')
    })
  }

  it('POST /admin/removeInvalidOps rejects a bad secret with 401', async () => {
    const res = await post('/admin/removeInvalidOps', {
      adminSecret: 'wrong',
      did: unknownDid,
      cid: 'bafyreib2rxk3rh6kzwq',
    })
    expect(res.status).toEqual(401)
  })

  it('POST /:did rejects a malformed operation with 400', async () => {
    const res = await post(`/${unknownDid}`, { not: 'an op' })
    expect(res.status).toEqual(400)
  })

  it('serves a valid request normally', async () => {
    const res = await get('/_health')
    expect(res.status).toEqual(200)
  })
})
