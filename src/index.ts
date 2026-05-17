import { env } from './config/env'
import { logger } from './utils/logger'
import { connectDB, closeDB } from './db'
import { closeQueues } from './jobs/queue'
import { recoverPendingJobs } from './jobs/recoverPendingJobs'
import app from './app'

// Import workers to start them
import './jobs/workers/scrapeWorker'
import './jobs/workers/analyzeWorker'
import './jobs/workers/instagramWorker'

const server = app.listen(env.PORT, () => {
  logger.info(`🚀 ScriptAI backend running on port ${env.PORT}`, {
    env: env.NODE_ENV,
    port: env.PORT,
  })
})

// Startup: connect to database, then recover any jobs lost after restart
connectDB()
  .then(() => recoverPendingJobs())
  .catch((error) => {
    logger.error('Failed to connect to database on startup', { error })
    process.exit(1)
  })

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info(`${signal} received, shutting down gracefully`)

  // Close all keep-alive connections immediately so the port is freed fast
  if (typeof (server as any).closeAllConnections === 'function') {
    ;(server as any).closeAllConnections()
  }

  server.close(async () => {
    try {
      await closeQueues()
      await closeDB()
      logger.info('Graceful shutdown complete')
      process.exit(0)
    } catch (error) {
      logger.error('Error during shutdown', { error })
      process.exit(1)
    }
  })

  // Force exit after 2 seconds so nodemon restart never hits EADDRINUSE
  setTimeout(() => {
    process.exit(0)
  }, 2000)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason, promise })
})

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error })
  process.exit(1)
})

export default server
