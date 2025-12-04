import pino from 'pino'
import pinoHttp from 'pino-http'

const enabledEnv = process.env.LOG_ENABLED
const enabled =
  enabledEnv === 'true' || enabledEnv === 't' || enabledEnv === '1'
const level = process.env.LOG_LEVEL || 'info'

const config = {
  enabled,
  level,
}

const logger = process.env.LOG_DESTINATION
  ? pino(config, pino.destination(process.env.LOG_DESTINATION))
  : pino(config)

export const leaderLogger = logger.child({
  name: 'SequencerLeader',
})

export const seqLogger = logger.child({
  name: 'Sequencer',
})

export const loggerMiddleware = pinoHttp({
  logger,
})
