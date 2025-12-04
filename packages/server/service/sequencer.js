'use strict' /* eslint-disable */

require('dd-trace/init') // Only works with commonjs
const { Database, SequencerLeader, leaderLogger } = require('..')

const main = async () => {
  const dbCreds = JSON.parse(process.env.DB_CREDS_JSON)
  const dbSchema = process.env.DB_SCHEMA || undefined
  const dbPoolSize = parseMaybeInt(process.env.DB_POOL_SIZE)
  const dbPoolMaxUses = parseMaybeInt(process.env.DB_POOL_MAX_USES)
  const dbPoolIdleTimeoutMs = parseMaybeInt(process.env.DB_POOL_IDLE_TIMEOUT_MS)
  const db = Database.postgres({
    url: pgUrl(dbCreds),
    schema: dbSchema,
    poolSize: dbPoolSize,
    poolMaxUses: dbPoolMaxUses,
    poolIdleTimeoutMs: dbPoolIdleTimeoutMs,
  })
  const leader = new SequencerLeader(db)
  leader.run()

  const statsInterval = setInterval(async () => {
    if (leader?.isLeader) {
      try {
        const seq = await leader.lastSeq()
        leaderLogger.info({ seq }, 'sequencer leader stats')
      } catch (err) {
        leaderLogger.error({ err }, 'error getting last seq')
      }
    }
  }, 500)

  // Graceful shutdown (see also https://aws.amazon.com/blogs/containers/graceful-shutdowns-with-ecs/)
  process.on('SIGTERM', async () => {
    leader.destroy()
    clearInterval(statsInterval)
  })
}

const pgUrl = ({ username = "postgres", password = "postgres", host = "localhost", port = "5432", database = "postgres", sslmode }) => {
  const enc = encodeURIComponent
  return `postgresql://${username}:${enc(password)}@${host}:${port}/${database}${sslmode ? `?sslmode=${enc(sslmode)}` : ''}`
}

const parseMaybeInt = (str) => {
  return str ? parseInt(str, 10) : undefined
}

main()
