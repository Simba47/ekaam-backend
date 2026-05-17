import Bull from 'bull'
import { scrapeQueue, ScrapeJobData } from '../queue'
import { scraperAgent } from '../../agents/scraperAgent'
import { db } from '../../db'
import { trainingSources } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { logger } from '../../utils/logger'

scrapeQueue.process(3, async (job: Bull.Job<ScrapeJobData>) => {
  const { sourceId, url, type } = job.data

  logger.info('Processing scrape job', { jobId: job.id, sourceId, url, type })

  try {
    await scraperAgent.run({ sourceId, url, type })
    logger.info('Scrape job completed', { jobId: job.id, sourceId })
  } catch (error) {
    logger.error('Scrape job failed', {
      jobId: job.id,
      sourceId,
      error: (error as Error).message,
    })
    throw error
  }
})

scrapeQueue.on('failed', async (job: Bull.Job<ScrapeJobData>, error: Error) => {
  const { sourceId } = job.data

  if (job.attemptsMade >= (job.opts.attempts ?? 3)) {
    logger.error('Scrape job permanently failed after max retries', {
      jobId: job.id,
      sourceId,
      error: error.message,
    })

    try {
      await db
        .update(trainingSources)
        .set({
          status: 'failed',
          errorMessage: `Job failed after ${job.attemptsMade} attempts: ${error.message}`,
          updatedAt: new Date(),
        })
        .where(eq(trainingSources.id, sourceId))
    } catch (dbError) {
      logger.error('Failed to update source status after job failure', {
        sourceId,
        error: (dbError as Error).message,
      })
    }
  }
})

logger.info('Scrape worker started with concurrency 3')
