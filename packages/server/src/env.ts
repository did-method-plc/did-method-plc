// NOTE: this file should be imported first, particularly before `./logger.js`, to ensure that environment variables are respected when the logger reads them at module load
import dotenv from 'dotenv'

const env = process.env.ENV
if (env) {
  dotenv.config({ path: `./.${env}.env` })
} else {
  dotenv.config()
}
