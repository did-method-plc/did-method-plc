export class AsyncBuffer<T> {
  private buffer: T[] = []
  private promise: Promise<void>
  private resolve: () => void
  private closed = false
  private toThrow: unknown | undefined

  constructor(public maxSize?: number) {
    // Initializing to satisfy types/build, immediately reset by resetPromise()
    this.promise = Promise.resolve()
    this.resolve = () => null
    this.resetPromise()
  }

  get curr(): T[] {
    return this.buffer
  }

  get size(): number {
    return this.buffer.length
  }

  get isClosed(): boolean {
    return this.closed
  }

  resetPromise() {
    this.promise = new Promise<void>((r) => (this.resolve = r))
  }

  push(item: T) {
    this.buffer.push(item)
    this.resolve()
  }

  pushMany(items: T[]) {
    items.forEach((i) => this.buffer.push(i))
    this.resolve()
  }

  async *events(): AsyncGenerator<T> {
    while (true) {
      if (this.closed && this.buffer.length === 0) {
        if (this.toThrow) {
          throw this.toThrow
        } else {
          return
        }
      }
      await this.promise
      if (this.toThrow) {
        throw this.toThrow
      }
      if (this.maxSize && this.size > this.maxSize) {
        throw new AsyncBufferFullError(this.maxSize)
      }
      const [first, ...rest] = this.buffer
      if (first) {
        this.buffer = rest
        yield first
      } else {
        this.resetPromise()
      }
    }
  }

  throw(err: unknown) {
    this.toThrow = err
    this.closed = true
    this.resolve()
  }

  close() {
    this.closed = true
    this.resolve()
  }
}

export class AsyncBufferFullError extends Error {
  constructor(maxSize: number) {
    super(`ReachedMaxBufferSize: ${maxSize}`)
  }
}
