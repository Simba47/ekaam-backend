import { db } from '../../db'
import { trainingSources, styleKnowledge, users, userPersonalStyle, trainingContent, contentAnalysis } from '../../db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { addScrapeJob } from '../../jobs/queue'
import { styleAnalyzerAgent } from '../../agents/styleAnalyzerAgent'
import { createError } from '../../middleware/errorHandler'
import { logger } from '../../utils/logger'

const MAX_SOURCES_PER_USER = 5   // max YouTube channels/videos a user can train on
const MAX_VIDEOS_PER_SOURCE = 100

export const clientTrainingService = {
  // Add a user's own YouTube/Instagram for personal style training
  async addSource(userId: string, data: {
    url: string
    type: 'youtube_channel' | 'youtube_video' | 'instagram_reel' | 'instagram_account'
    language?: string
    niche?: string
  }) {
    // Enforce per-user source limit
    const existingSources = await db.query.trainingSources.findMany({
      where: and(
        eq(trainingSources.userId, userId),
        eq(trainingSources.addedBy, 'user')
      ),
    })

    if (existingSources.length >= MAX_SOURCES_PER_USER) {
      throw createError(`You can add up to ${MAX_SOURCES_PER_USER} training sources`, 422)
    }

    // Check if this user already added this URL
    const duplicate = existingSources.find(s => s.url === data.url)
    if (duplicate) {
      throw createError('You have already added this URL', 409)
    }

    const [source] = await db
      .insert(trainingSources)
      .values({
        type:     data.type,
        url:      data.url,
        language: data.language ?? 'auto',
        niche:    data.niche ?? 'other',
        status:   'pending',
        addedBy:  'user',
        userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()

    // Mark user trainingStatus as pending
    await db.update(users)
      .set({ trainingStatus: 'processing', updatedAt: new Date() })
      .where(eq(users.id, userId))

    await addScrapeJob({ sourceId: source.id, url: data.url, type: data.type as 'youtube_channel' | 'youtube_video' | 'instagram_account' })

    logger.info('User training source added', { userId, sourceId: source.id, url: data.url })
    return source
  },

  async listSources(userId: string) {
    return db.query.trainingSources.findMany({
      where: and(
        eq(trainingSources.userId, userId),
        eq(trainingSources.addedBy, 'user')
      ),
      orderBy: [desc(trainingSources.createdAt)],
    })
  },

  async getSource(userId: string, sourceId: string) {
    const source = await db.query.trainingSources.findFirst({
      where: and(eq(trainingSources.id, sourceId), eq(trainingSources.userId, userId)),
    })
    if (!source) throw createError('Source not found', 404)
    return source
  },

  async deleteSource(userId: string, sourceId: string) {
    const source = await db.query.trainingSources.findFirst({
      where: and(eq(trainingSources.id, sourceId), eq(trainingSources.userId, userId)),
    })
    if (!source) throw createError('Source not found', 404)

    // Cascades handle trainingContent, contentAnalysis, styleKnowledge
    await db.delete(trainingSources).where(eq(trainingSources.id, sourceId))

    // If user has no more training sources, reset their trainingStatus
    const remaining = await db.query.trainingSources.findMany({
      where: and(eq(trainingSources.userId, userId), eq(trainingSources.addedBy, 'user')),
    })
    if (remaining.length === 0) {
      await db.update(users)
        .set({ trainingStatus: 'none', updatedAt: new Date() })
        .where(eq(users.id, userId))
    }

    logger.info('User training source deleted', { userId, sourceId })
  },

  async retrainSource(userId: string, sourceId: string) {
    const source = await db.query.trainingSources.findFirst({
      where: and(eq(trainingSources.id, sourceId), eq(trainingSources.userId, userId)),
    })
    if (!source) throw createError('Source not found', 404)

    await db.delete(styleKnowledge).where(eq(styleKnowledge.sourceId, sourceId))
    await db.update(trainingSources)
      .set({ status: 'pending', errorMessage: null, processedVideos: 0, updatedAt: new Date() })
      .where(eq(trainingSources.id, sourceId))

    await addScrapeJob({ sourceId, url: source.url, type: source.type as 'youtube_channel' | 'youtube_video' | 'instagram_account' })
    logger.info('User training source requeued', { userId, sourceId })
    return { message: 'Retraining started' }
  },

  // Rebuild only the master style profile from existing analyses — fast (no re-scraping)
  async rebuildProfile(userId: string, sourceId: string) {
    const source = await db.query.trainingSources.findFirst({
      where: and(eq(trainingSources.id, sourceId), eq(trainingSources.userId, userId)),
    })
    if (!source) throw createError('Source not found', 404)

    // Must have existing analysis data — check for processed content
    const contents = await db.query.trainingContent.findMany({
      where: eq(trainingContent.sourceId, sourceId),
    })
    if (contents.length === 0) throw createError('No training data found — please use full retrain instead', 422)

    const analyses = await Promise.all(
      contents.map(c => db.query.contentAnalysis.findFirst({
        where: eq(contentAnalysis.contentId, c.id),
      }))
    )
    const validAnalyses = analyses.filter(Boolean)
    if (validAnalyses.length === 0) throw createError('No video analyses found — please use full retrain instead', 422)

    // Delete old style knowledge and mark as processing
    await db.delete(styleKnowledge).where(eq(styleKnowledge.sourceId, sourceId))
    await db.update(trainingSources)
      .set({ status: 'processing', errorMessage: null, updatedAt: new Date() })
      .where(eq(trainingSources.id, sourceId))

    // Re-run master profile builder in background (non-blocking)
    styleAnalyzerAgent.buildMasterStyleProfile(sourceId).catch(err => {
      logger.error('Rebuild profile failed', { sourceId, error: err.message })
    })

    logger.info('Profile rebuild started (fast mode)', { userId, sourceId, analyses: validAnalyses.length })
    return { message: `Rebuilding profile from ${validAnalyses.length} existing analyses — will be ready in ~30 seconds` }
  },

  async getStyleProfile(userId: string) {
    const profile = await db.query.userPersonalStyle.findFirst({
      where: eq(userPersonalStyle.userId, userId),
    })
    return profile ?? null
  },

  // Summary of all user sources with overall readiness
  async getTrainingStatus(userId: string) {
    const sources = await db.query.trainingSources.findMany({
      where: and(eq(trainingSources.userId, userId), eq(trainingSources.addedBy, 'user')),
    })
    const ready = sources.filter(s => s.status === 'ready').length
    const processing = sources.filter(s => s.status === 'processing' || s.status === 'pending').length
    const failed = sources.filter(s => s.status === 'failed').length
    return { sources, ready, processing, failed, total: sources.length }
  },
}
