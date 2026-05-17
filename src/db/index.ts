import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { env } from '../config/env'
import { logger } from '../utils/logger'
import * as schema from './schema'

// Production-grade pool: handles 1000s of concurrent users
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 50,                    // max 50 simultaneous DB connections
  min: 5,                     // keep 5 warm at all times
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  allowExitOnIdle: false,
})

pool.on('error', (err) => {
  logger.error('Unexpected error on idle database client', { error: err.message })
})

pool.on('connect', () => {
  logger.debug('New database connection established')
})

export const db = drizzle(pool, { schema })

export const connectDB = async (): Promise<void> => {
  try {
    const client = await pool.connect()
    await client.query('SELECT 1')
    client.release()
    logger.info('✅ Database connected successfully', {
      max: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
    })
  } catch (error) {
    logger.error('❌ Database connection failed', { error })
    throw error
  }
}

export const closeDB = async (): Promise<void> => {
  await pool.end()
  logger.info('Database connection pool closed')
}

export { pool }
