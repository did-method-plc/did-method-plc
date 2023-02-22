// @TODO fix
export class ServerError extends Error {
  constructor(public code: number, msg: string) {
    super(msg)
  }
}
