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

let rateLimiters: Map<string, RateLimiterRedis> = new Map()
export async function rateLimit(
  ctx: AppContext,
  response: any,
  limiterName: string,
  key: string,
  limit: number,
  windowDurationSec: number,
): Promise<undefined> {
  if (!ctx.redis) {
    return
  }
  let limiter = rateLimiters.get(limiterName)
  if (!limiter) {
    limiter = new RateLimiterRedis({
      points: limit,
      duration: windowDurationSec,
      storeClient: ctx.redis,
      keyPrefix: 'rate-limit-' + limiterName,
    })
    rateLimiters.set(limiterName, limiter)
  }
  await limiter
    ?.consume(key, 1)
    .then((rateLimitRes) => {
      setResponseHeaders(response, limit, windowDurationSec, rateLimitRes)
    })
    .catch((rateLimitRes) => {
      setResponseHeaders(response, limit, windowDurationSec, rateLimitRes)
      throw new ServerError(429, 'Rate limit exceeded')
    })
}

export function rateLimitPerDay(
  ctx: AppContext,
  response: any,
  limiterName: string,
  key: string,
  limit: number,
): Promise<undefined> {
  return rateLimit(ctx, response, limiterName, key, limit, 86400)
}

export function rateLimitPerHour(
  ctx: AppContext,
  response: any,
  limiterName: string,
  key: string,
  limit: number,
): Promise<undefined> {
  return rateLimit(ctx, response, limiterName, key, limit, 3600)
}

export function rateLimitPerMinute(
  ctx: AppContext,
  response: any,
  limiterName: string,
  key: string,
  limit: number,
): Promise<undefined> {
  return rateLimit(ctx, response, limiterName, key, limit, 60)
}

export function rateLimitPerSecond(
  ctx: AppContext,
  response: any,
  limiterName: string,
  key: string,
  limit: number,
): Promise<undefined> {
  return rateLimit(ctx, response, limiterName, key, limit, 1)
}
