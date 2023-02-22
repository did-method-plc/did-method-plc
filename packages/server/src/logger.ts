import pino from 'pino'
import pinoHttp from 'pino-http'

// @TODO fix this up
export const logger = pino()

export const loggerMiddleware = pinoHttp({
  logger,
})
