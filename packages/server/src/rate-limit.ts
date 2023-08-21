import AppContext from './context'
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible'
import { ServerError } from './error'

function setResponseHeaders(
  response: any,
  limit: number,
  windowDurationSec: number,
  rateLimitRes: RateLimiterRes,
) {
  response.setHeader('RateLimit-Limit', limit)
  response.setHeader('RateLimit-Remaining', rateLimitRes.remainingPoints)
  response.setHeader(
    'RateLimit-Reset',
    Math.floor((Date.now() + rateLimitRes.msBeforeNext) / 1000),
  )
  response.setHeader('RateLimit-Policy', `${limit};w=${windowDurationSec}`)
}

let rateLimiterIDCounter = 0
export function rateLimit(
  ctx: AppContext,
  limit: number,
  duration: number,
  keyFunc: (req: any) => string,
): (req: any, res: any, next: any) => Promise<void> {
  // Without Redis support, don't rate limit at all
  if (!ctx.redis) {
    return async (req, res, next) => {
      next()
    }
  }
  // Tests have a tendency to spam requests, so we need a higher limit in debug mode
  if (ctx.debug) {
    limit = limit * 10
  }
  const limiter = new RateLimiterRedis({
    points: limit,
    duration: duration,
    storeClient: ctx.redis,
    keyPrefix: 'rate-limit-' + rateLimiterIDCounter++,
  })
  const middleware = async (req, res, next) => {
    // Bypass rate limiting completely if the secret bypass token is provided
    const bypassToken = req.get('X-RateLimit-Bypass')
    if (
      ctx.rateLimitBypassToken !== undefined &&
      bypassToken === ctx.rateLimitBypassToken
    ) {
      next()
      return
    }
    console.log(req)
    const key = keyFunc(req)
    if (key) {
      await limiter.get(key).then((rateLimitRes) => {
        if (!!rateLimitRes) {
          setResponseHeaders(res, limit, duration, rateLimitRes)
          if (rateLimitRes.remainingPoints === 0) {
            throw new ServerError(429, 'Rate limit exceeded')
          }
        }
      })
    }
    next()
    if (key) {
      await limiter.consume(key).catch(() => {})
    }
  }
  return middleware
}

export function rateLimitPerDay(
  ctx: AppContext,
  limit: number,
  keyFunc: (req: any) => string,
): (req: any, res: any, next: any) => Promise<void> {
  return rateLimit(ctx, limit, 60 * 60 * 24, keyFunc)
}

export function rateLimitPerHour(
  ctx: AppContext,
  limit: number,
  keyFunc: (req: any) => string,
): (req: any, res: any, next: any) => Promise<void> {
  return rateLimit(ctx, limit, 60 * 60, keyFunc)
}

export function rateLimitPerMinute(
  ctx: AppContext,
  limit: number,
  keyFunc: (req: any) => string,
): (req: any, res: any, next: any) => Promise<void> {
  return rateLimit(ctx, limit, 60, keyFunc)
}

export function rateLimitPerSecond(
  ctx: AppContext,
  limit: number,
  keyFunc: (req: any) => string,
): (req: any, res: any, next: any) => Promise<void> {
  return rateLimit(ctx, limit, 1, keyFunc)
}
