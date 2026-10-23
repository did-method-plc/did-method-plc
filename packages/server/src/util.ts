import { timingSafeEqual } from 'node:crypto'
import { TextEncoder } from 'node:util'

export const HOUR = 60 * 60 * 1000
export const DAY = 24 * HOUR

export const jitter = (maxMs: number) => {
  return Math.round((Math.random() - 0.5) * maxMs * 2)
}

export const wait = (ms: number) => {
  return new Promise((res) => setTimeout(res, ms))
}

const utf8Encoder = new TextEncoder()

// returns true if both strings are equal
export const timingSafeStringEqual = (a: string, b: string): boolean => {
  // NOTE: timing will still vary based on the *lengths* of the input strings

  const bufA = utf8Encoder.encode(a)
  const bufB = utf8Encoder.encode(b)

  // timingSafeEqual only works on buffers of equal length
  if (bufA.length !== bufB.length) {
    return false
  }

  return timingSafeEqual(bufA, bufB)
}

export async function* stringify(
  iterable: AsyncIterable<unknown>,
): AsyncIterable<string> {
  for await (const item of iterable) {
    yield JSON.stringify(item)
  }
}
