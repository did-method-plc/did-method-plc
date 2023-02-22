import axios from 'axios'
import * as t from './types'

export class Client {
  constructor(public url: string) {}

  async getDocument(did: string): Promise<t.DidDocument> {
    const res = await axios.get(`${this.url}/${encodeURIComponent(did)}`)
    return res.data
  }

  async getDocumentData(did: string): Promise<t.DocumentData> {
    const res = await axios.get(`${this.url}/data/${encodeURIComponent(did)}`)
    return res.data
  }

  async getOperationLog(did: string): Promise<t.Operation[]> {
    const res = await axios.get(`${this.url}/log/${encodeURIComponent(did)}`)
    return res.data.log
  }

  postOpUrl(did: string): string {
    return `${this.url}/${encodeURIComponent(did)}`
  }

  async sendOperation(did: string, op: t.Operation) {
    await axios.post(this.postOpUrl(did), op)
  }

  async health() {
    return await axios.get(`${this.url}/_health`)
  }
}

export default Client
