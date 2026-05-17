/**
 * Direct in-process job runner — used as fallback when Redis is unavailable.
 * Uses dynamic imports to avoid circular dependency with queue.ts.
 * Limits concurrency so Claude API isn't hit with 200+ simultaneous requests.
 */
import { logger } from '../utils/logger'

// ── Concurrency limiter for analyze jobs ──────────────────────────────────────
// Keep at 1 — Claude free tier is 5 req/min; running 5 at once blows the limit instantly.
const MAX_CONCURRENT = 1
const INTER_JOB_DELAY_MS = 13_000 // ~4.5 req/min — safely under 5/min rate limit
let activeAnalyze = 0
const analyzeQueue: Array<{ contentId: string; sourceId: string }> = []

async function runNextAnalyze() {
  if (activeAnalyze >= MAX_CONCURRENT || analyzeQueue.length === 0) return
  const data = analyzeQueue.shift()!
  activeAnalyze++
  logger.info('[Direct] Running analyze job', { contentId: data.contentId, active: activeAnalyze, queued: analyzeQueue.length })
  try {
    const { styleAnalyzerAgent } = await import('../agents/styleAnalyzerAgent')
    await styleAnalyzerAgent.analyzeContent(data.contentId)
    logger.info('[Direct] Analyze job completed', { contentId: data.contentId })
  } catch (error) {
    logger.error('[Direct] Analyze job failed', { contentId: data.contentId, error: (error as Error).message })
  } finally {
    activeAnalyze--
    setTimeout(runNextAnalyze, INTER_JOB_DELAY_MS) // pace jobs to respect rate limit
  }
}

export const runAnalyzeJobDirect = (data: { contentId: string; sourceId: string }) => {
  analyzeQueue.push(data)
  setImmediate(runNextAnalyze)
}

// ── Instagram jobs ────────────────────────────────────────────────────────────
export const runInstagramJobDirect = (data: { sourceId?: string; userId?: string; accountUrl: string; accessToken?: string }) => {
  setImmediate(async () => {
    logger.info('[Direct] Running instagram job', { url: data.accountUrl })
    try {
      const { instagramService } = await import('../modules/instagram/instagram.service')
      if (data.sourceId) {
        await instagramService.scrapeAccount({ url: data.accountUrl, sourceId: data.sourceId })
      }
      logger.info('[Direct] Instagram job completed', { url: data.accountUrl })
    } catch (error) {
      logger.error('[Direct] Instagram job failed', { url: data.accountUrl, error: (error as Error).message })
    }
  })
}

// ── Scrape jobs run one at a time (they already serialize internally) ─────────
export const runScrapeJobDirect = (data: { sourceId: string; url: string; type: string }) => {
  setImmediate(async () => {
    logger.info('[Direct] Running scrape job', { sourceId: data.sourceId })
    try {
      const { scraperAgent } = await import('../agents/scraperAgent')
      await scraperAgent.run(data)
      logger.info('[Direct] Scrape job completed', { sourceId: data.sourceId })
    } catch (error) {
      logger.error('[Direct] Scrape job failed', { sourceId: data.sourceId, error: (error as Error).message })
    }
  })
}
