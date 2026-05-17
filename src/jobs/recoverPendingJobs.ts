/**
 * On startup, re-queue any training content that never got analyzed.
 * Needed because the direct runner queue is in-memory — a restart wipes pending jobs.
 */
import { db } from '../db'
import { trainingContent, contentAnalysis, trainingSources } from '../db/schema'
import { eq, isNull } from 'drizzle-orm'
import { addAnalyzeJob } from './queue'
import { logger } from '../utils/logger'

export async function recoverPendingJobs(): Promise<void> {
  try {
    // Find all sources still in processing state
    const processingSources = await db.query.trainingSources.findMany({
      where: eq(trainingSources.status, 'processing'),
    })

    if (processingSources.length === 0) {
      logger.info('[Recovery] No sources in processing state, nothing to recover')
      return
    }

    let totalQueued = 0

    for (const source of processingSources) {
      // Find content with a transcript that has no contentAnalysis record
      const allContent = await db.query.trainingContent.findMany({
        where: eq(trainingContent.sourceId, source.id),
      })

      // Find which ones are already analyzed
      const analyzedIds = new Set<string>()
      for (const c of allContent) {
        if (!c.fullTranscript) continue
        const analysis = await db.query.contentAnalysis.findFirst({
          where: eq(contentAnalysis.contentId, c.id),
        })
        if (analysis) analyzedIds.add(c.id)
      }

      // Re-queue those with transcripts that are not yet analyzed
      const toQueue = allContent.filter(
        (c) => c.fullTranscript && !analyzedIds.has(c.id)
      )

      logger.info('[Recovery] Re-queuing unanalyzed videos', {
        sourceId: source.id,
        name: source.name,
        total: allContent.length,
        alreadyAnalyzed: analyzedIds.size,
        reQueuing: toQueue.length,
      })

      for (const content of toQueue) {
        await addAnalyzeJob({ contentId: content.id, sourceId: source.id })
      }

      totalQueued += toQueue.length
    }

    logger.info('[Recovery] Recovery complete', { totalQueued })
  } catch (error) {
    logger.error('[Recovery] Failed to recover pending jobs', {
      error: (error as Error).message,
    })
  }
}
