import Bull from 'bull'
import { analyzeQueue, AnalyzeJobData } from '../queue'
import { styleAnalyzerAgent } from '../../agents/styleAnalyzerAgent'
import { logger } from '../../utils/logger'

analyzeQueue.process(5, async (job: Bull.Job<AnalyzeJobData>) => {
  const { contentId, sourceId } = job.data

  logger.info('Processing analyze job', { jobId: job.id, contentId, sourceId })

  try {
    await styleAnalyzerAgent.analyzeContent(contentId)
    logger.info('Analyze job completed', { jobId: job.id, contentId })
  } catch (error) {
    logger.error('Analyze job failed', {
      jobId: job.id,
      contentId,
      error: (error as Error).message,
    })
    throw error
  }
})

analyzeQueue.on('failed', async (job: Bull.Job<AnalyzeJobData>, error: Error) => {
  if (job.attemptsMade >= (job.opts.attempts ?? 3)) {
    logger.error('Analyze job permanently failed after max retries', {
      jobId: job.id,
      contentId: job.data.contentId,
      error: error.message,
    })
  }
})

logger.info('Analyze worker started with concurrency 5')
