import { Duplex } from 'stream'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ws?: {
        socket: Duplex
        head: Buffer
        handled: boolean
      }
    }
  }
}

declare module 'http' {
  interface IncomingMessage {
    ws?: {
      socket: Duplex
      head: Buffer
      handled: boolean
    }
  }
}
