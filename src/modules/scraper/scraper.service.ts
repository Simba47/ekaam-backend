import { db } from '../../db'
import { trainingSources } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { scrapeQueue } from '../../jobs/queue'
import { createError } from '../../middleware/errorHandler'

export const scraperService = {
  async getJobProgress(sourceId: string) {
    const source = await db.query.trainingSources.findFirst({
      where: eq(trainingSources.id, sourceId),
    })

    if (!source) {
      throw createError('Source not found', 404)
    }

    // Get active jobs for this source
    const activeJobs = await scrapeQueue.getActive()
    const waitingJobs = await scrapeQueue.getWaiting()

    const isActive = activeJobs.some((j) => j.data.sourceId === sourceId)
    const isWaiting = waitingJobs.some((j) => j.data.sourceId === sourceId)

    return {
      sourceId,
      status: source.status,
      totalVideos: source.totalVideos ?? 0,
      processedVideos: source.processedVideos ?? 0,
      progress:
        source.totalVideos && source.totalVideos > 0
          ? Math.round(((source.processedVideos ?? 0) / source.totalVideos) * 100)
          : 0,
      isActive,
      isWaiting,
      errorMessage: source.errorMessage,
    }
  },
}
