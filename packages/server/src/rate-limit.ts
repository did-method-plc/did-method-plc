import AppContext from './context'
import {
  RateLimiterAbstract,
  RateLimiterMemory,
  RateLimiterRedis,
  RateLimiterRes,
} from 'rate-limiter-flexible'
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

let rateLimiters: Map<string, RateLimiterAbstract> = new Map()
export async function rateLimit(
  ctx: AppContext,
  request: any,
  response: any,
  limiterName: string,
  key: string,
  windowLimit: number,
  windowDurationSec: number,
): Promise<void> {
  // No rate limiting without Redis support
  if (!ctx.redis) {
    return
  }
  // If we receive the secret bypass token, don't rate limit
  const bypassToken = request.get('X-RateLimit-Bypass')
  if (
    ctx.rateLimitBypassToken !== undefined &&
    bypassToken === ctx.rateLimitBypassToken
  ) {
    return
  }
  // Tests oftentimes run much faster than normal clients, so increase rate limit
  if (ctx.debug) {
    windowLimit = windowLimit * 10
  }
  let limiter = rateLimiters.get(limiterName)
  if (!limiter) {
    limiter = new RateLimiterRedis({
      points: windowLimit,
      duration: windowDurationSec,
      storeClient: ctx.redis,
      keyPrefix: 'rate-limit-' + limiterName,
    })
    rateLimiters.set(limiterName, limiter)
  }
  await limiter
    ?.consume(key, 1)
    .then((rateLimitRes) => {
      setResponseHeaders(response, windowLimit, windowDurationSec, rateLimitRes)
    })
    .catch((rateLimitRes) => {
      setResponseHeaders(response, windowLimit, windowDurationSec, rateLimitRes)
      throw new ServerError(429, 'Rate limit exceeded')
    })
}

export function rateLimitPerDay(
  ctx: AppContext,
  request: any,
  response: any,
  limiterName: string,
  key: string,
  limit: number,
): Promise<void> {
  return rateLimit(ctx, request, response, limiterName, key, limit, 86400)
}

export function rateLimitPerHour(
  ctx: AppContext,
  request: any,
  response: any,
  limiterName: string,
  key: string,
  limit: number,
): Promise<void> {
  return rateLimit(ctx, request, response, limiterName, key, limit, 3600)
}

export function rateLimitPerMinute(
  ctx: AppContext,
  request: any,
  response: any,
  limiterName: string,
  key: string,
  limit: number,
): Promise<void> {
  return rateLimit(ctx, request, response, limiterName, key, limit, 60)
}

export function rateLimitPerSecond(
  ctx: AppContext,
  request: any,
  response: any,
  limiterName: string,
  key: string,
  limit: number,
): Promise<void> {
  return rateLimit(ctx, request, response, limiterName, key, limit, 1)
}
