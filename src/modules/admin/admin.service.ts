import { db } from '../../db'
import {
  trainingSources,
  trainingContent,
  contentAnalysis,
  styleKnowledge,
  generatedScripts,
} from '../../db/schema'
import { eq, desc, count } from 'drizzle-orm'
import { addScrapeJob } from '../../jobs/queue'
import { createError } from '../../middleware/errorHandler'
import { logger } from '../../utils/logger'
import { styleAnalyzerAgent } from '../../agents/styleAnalyzerAgent'

export const adminService = {
  async addSource(data: {
    url: string
    type: 'youtube_channel' | 'youtube_video' | 'instagram_account'
    niche: string
    language?: string
  }) {
    const { url, type, niche, language = 'auto' } = data

    // Check for duplicate URL
    const existing = await db.query.trainingSources.findFirst({
      where: eq(trainingSources.url, url),
    })

    if (existing) {
      throw createError('This URL has already been added', 409)
    }

    const [source] = await db
      .insert(trainingSources)
      .values({
        type,
        url,
        niche,
        language,
        status: 'pending',
        addedBy: 'admin',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()

    // Queue the scraping job
    await addScrapeJob({ sourceId: source.id, url, type })

    logger.info('Source added and queued for scraping', {
      sourceId: source.id,
      url,
      type,
    })

    return source
  },

  async listSources() {
    return db.query.trainingSources.findMany({
      orderBy: [desc(trainingSources.createdAt)],
    })
  },

  async getSource(id: string) {
    const source = await db.query.trainingSources.findFirst({
      where: eq(trainingSources.id, id),
    })

    if (!source) {
      throw createError('Source not found', 404)
    }

    return source
  },

  async deleteSource(id: string) {
    const source = await db.query.trainingSources.findFirst({
      where: eq(trainingSources.id, id),
    })

    if (!source) {
      throw createError('Source not found', 404)
    }

    // Delete in dependency order — don't rely on DB-level CASCADE

    // 1. Null out sourceId on generated scripts (no cascade on this FK)
    await db
      .update(generatedScripts)
      .set({ sourceId: null })
      .where(eq(generatedScripts.sourceId, id))

    // 2. Delete content analysis (references trainingContent)
    const contents = await db.query.trainingContent.findMany({
      where: eq(trainingContent.sourceId, id),
    })
    for (const content of contents) {
      await db.delete(contentAnalysis).where(eq(contentAnalysis.contentId, content.id))
    }

    // 3. Delete training content
    await db.delete(trainingContent).where(eq(trainingContent.sourceId, id))

    // 4. Delete style knowledge
    await db.delete(styleKnowledge).where(eq(styleKnowledge.sourceId, id))

    // 5. Delete the source itself
    await db.delete(trainingSources).where(eq(trainingSources.id, id))

    logger.info('Source and all training data deleted', { sourceId: id })
  },

  async retrainSource(id: string) {
    const source = await db.query.trainingSources.findFirst({
      where: eq(trainingSources.id, id),
    })

    if (!source) {
      throw createError('Source not found', 404)
    }

    // Reset source status
    await db
      .update(trainingSources)
      .set({
        status: 'pending',
        errorMessage: null,
        processedVideos: 0,
        updatedAt: new Date(),
      })
      .where(eq(trainingSources.id, id))

    // Clear old content analysis and style knowledge
    await db
      .delete(styleKnowledge)
      .where(eq(styleKnowledge.sourceId, id))

    // Re-queue scraping
    await addScrapeJob({ sourceId: id, url: source.url, type: source.type as 'youtube_channel' | 'youtube_video' | 'instagram_account' })

    logger.info('Source queued for retraining', { sourceId: id })

    return { message: 'Source queued for retraining' }
  },

  async getStyleProfile(sourceId: string) {
    const profile = await db.query.styleKnowledge.findFirst({
      where: eq(styleKnowledge.sourceId, sourceId),
    })

    if (!profile) {
      throw createError('Style profile not ready yet', 404)
    }

    return profile
  },

  async getSourceContent(sourceId: string) {
    return db.query.trainingContent.findMany({
      where: eq(trainingContent.sourceId, sourceId),
      orderBy: [desc(trainingContent.scrapedAt)],
    })
  },

  async getContentDetail(sourceId: string, contentId: string) {
    const content = await db.query.trainingContent.findFirst({
      where: eq(trainingContent.id, contentId),
    })

    if (!content || content.sourceId !== sourceId) {
      throw createError('Content not found', 404)
    }

    const analysis = await db.query.contentAnalysis.findFirst({
      where: eq(contentAnalysis.contentId, contentId),
    })

    return { content, analysis }
  },

  async buildProfile(id: string) {
    const source = await db.query.trainingSources.findFirst({
      where: eq(trainingSources.id, id),
    })

    if (!source) {
      throw createError('Source not found', 404)
    }

    logger.info('Manually triggering master profile build', { sourceId: id })
    await styleAnalyzerAgent.buildMasterStyleProfile(id)

    return { message: 'Profile built successfully' }
  },

  async getDashboardStats() {
    const [sourcesResult] = await db
      .select({ total: count() })
      .from(trainingSources)

    const statusCounts = await db
      .select({
        status: trainingSources.status,
        count: count(),
      })
      .from(trainingSources)
      .groupBy(trainingSources.status)

    const [contentResult] = await db
      .select({ total: count() })
      .from(trainingContent)

    const [scriptsResult] = await db
      .select({ total: count() })
      .from(generatedScripts)

    const recentSources = await db.query.trainingSources.findMany({
      orderBy: [desc(trainingSources.updatedAt)],
      limit: 5,
    })

    return {
      totalSources: sourcesResult.total,
      statusBreakdown: statusCounts.reduce(
        (acc, row) => {
          acc[row.status ?? 'unknown'] = row.count
          return acc
        },
        {} as Record<string, number>
      ),
      totalVideosProcessed: contentResult.total,
      totalScriptsGenerated: scriptsResult.total,
      recentActivity: recentSources,
    }
  },
}
