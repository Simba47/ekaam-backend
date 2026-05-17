import { db } from '../../db'
import { inspirationSources, trainingSources, styleKnowledge } from '../../db/schema'
import { eq, and } from 'drizzle-orm'
import { addScrapeJob } from '../../jobs/queue'
import { createError } from '../../middleware/errorHandler'
import { logger } from '../../utils/logger'

const MONTHLY_LIMITS = { accounts: 3, videos: 10 }

export const inspirationsService = {
  async getMonthlyUsage(userId: string) {
    const month = new Date().toISOString().slice(0, 7)
    const sources = await db.query.inspirationSources.findMany({
      where: and(eq(inspirationSources.userId, userId), eq(inspirationSources.addedMonth, month)),
    })
    const accountsAdded = sources.filter(s => s.type === 'youtube_channel' || s.type === 'instagram_account').length
    const videosAdded = sources.filter(s => s.type === 'youtube_video' || s.type === 'instagram_reel').length
    return {
      accountsAdded, videosAdded,
      accountsLimit: MONTHLY_LIMITS.accounts,
      videosLimit: MONTHLY_LIMITS.videos,
      accountsLeft: Math.max(0, MONTHLY_LIMITS.accounts - accountsAdded),
      videosLeft: Math.max(0, MONTHLY_LIMITS.videos - videosAdded),
    }
  },

  async addInspiration(userId: string, url: string) {
    const month = new Date().toISOString().slice(0, 7)
    const usage = await this.getMonthlyUsage(userId)

    const isInstagram = url.includes('instagram.com')
    const isSingleVideo = url.includes('youtu.be/') || url.includes('watch?v=') || url.includes('/reel/') || url.includes('/p/')
    const type = isInstagram ? (isSingleVideo ? 'instagram_reel' : 'instagram_account') : (isSingleVideo ? 'youtube_video' : 'youtube_channel')
    const isAccount = type === 'youtube_channel' || type === 'instagram_account'

    if (isAccount && usage.accountsLeft === 0) throw createError(`Limit: ${MONTHLY_LIMITS.accounts} creator accounts/month`, 429)
    if (!isAccount && usage.videosLeft === 0) throw createError(`Limit: ${MONTHLY_LIMITS.videos} videos/month`, 429)

    const existing = await db.query.inspirationSources.findFirst({ where: and(eq(inspirationSources.userId, userId), eq(inspirationSources.url, url)) })
    if (existing) throw createError('URL already added', 409)

    const [trainingSource] = await db.insert(trainingSources).values({ type: type as any, url, status: 'pending', addedBy: `inspiration:${userId}`, language: 'auto', niche: 'inspiration', createdAt: new Date(), updatedAt: new Date() }).returning()

    const [inspiration] = await db.insert(inspirationSources).values({ userId, url, type, status: 'pending', addedMonth: month, styleProfile: { trainingSourceId: trainingSource.id }, createdAt: new Date(), updatedAt: new Date() }).returning()

    await addScrapeJob({ sourceId: trainingSource.id, url, type: type as any })
    logger.info('Inspiration added', { userId, url, type })
    return inspiration
  },

  async listInspirations(userId: string) {
    const inspirations = await db.query.inspirationSources.findMany({
      where: eq(inspirationSources.userId, userId),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    })
    return Promise.all(inspirations.map(async (insp) => {
      const trainingSourceId = (insp.styleProfile as any)?.trainingSourceId
      if (!trainingSourceId) return insp
      const source = await db.query.trainingSources.findFirst({ where: eq(trainingSources.id, trainingSourceId) })
      if (!source) return insp
      if (source.status !== insp.status) {
        await db.update(inspirationSources).set({ status: source.status, name: source.name || insp.name, updatedAt: new Date() }).where(eq(inspirationSources.id, insp.id))
      }
      return { ...insp, status: source.status, name: source.name || insp.name, videosScraped: source.processedVideos || 0, trainingSourceId }
    }))
  },

  async deleteInspiration(userId: string, id: string) {
    const insp = await db.query.inspirationSources.findFirst({ where: and(eq(inspirationSources.id, id), eq(inspirationSources.userId, userId)) })
    if (!insp) throw createError('Not found', 404)
    await db.delete(inspirationSources).where(eq(inspirationSources.id, id))
  },

  async getStyleProfile(inspirationId: string, userId: string) {
    const insp = await db.query.inspirationSources.findFirst({ where: and(eq(inspirationSources.id, inspirationId), eq(inspirationSources.userId, userId)) })
    if (!insp) throw createError('Not found', 404)
    if (insp.status !== 'ready') throw createError('Style not ready yet', 422)
    const trainingSourceId = (insp.styleProfile as any)?.trainingSourceId
    const style = await db.query.styleKnowledge.findFirst({ where: eq(styleKnowledge.sourceId, trainingSourceId) })
    if (!style) throw createError('Style profile not built yet', 422)
    return { style, trainingSourceId }
  },
}
