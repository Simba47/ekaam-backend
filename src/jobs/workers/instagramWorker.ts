import Bull from 'bull'
import { instagramQueue, InstagramJobData } from '../queue'
import { instagramService } from '../../modules/instagram/instagram.service'
import { db } from '../../db'
import { users } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { logger } from '../../utils/logger'

instagramQueue.process(2, async (job: Bull.Job<InstagramJobData>) => {
  const { userId, sourceId, accountUrl, accessToken } = job.data

  logger.info('Processing instagram job', { jobId: job.id, userId, sourceId, accountUrl })

  try {
    if (sourceId) {
      await instagramService.scrapeAccount({ url: accountUrl, sourceId })
    }

    if (userId) {
      // Mark user training as processing
      await db
        .update(users)
        .set({ trainingStatus: 'processing', updatedAt: new Date() })
        .where(eq(users.id, userId))

      // Scrape and store user content
      await instagramService.scrapeAccount({
        url: accountUrl,
        sourceId: userId, // Use userId as sourceId for user content
      })

      // Mark training complete
      await db
        .update(users)
        .set({ trainingStatus: 'ready', updatedAt: new Date() })
        .where(eq(users.id, userId))
    }

    logger.info('Instagram job completed', { jobId: job.id })
  } catch (error) {
    logger.error('Instagram job failed', {
      jobId: job.id,
      error: (error as Error).message,
    })

    if (userId) {
      await db
        .update(users)
        .set({ trainingStatus: 'none', updatedAt: new Date() })
        .where(eq(users.id, userId))
        .catch(() => {})
    }

    throw error
  }
})

instagramQueue.on('failed', (job: Bull.Job<InstagramJobData>, error: Error) => {
  logger.error('Instagram job permanently failed', {
    jobId: job.id,
    error: error.message,
  })
})

logger.info('Instagram worker started with concurrency 2')
