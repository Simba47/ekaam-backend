import { Router, Request, Response } from 'express'
import { authenticate } from '../../middleware/authenticate'
import { runResearchAgent, generateContentIdeas, clearTrendCache } from '../../agents/research.agent'
import { db } from '../../db'
import { users, styleKnowledge } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { logger } from '../../utils/logger'

const router = Router()

// GET /api/v1/trends — get trending topics for the authenticated creator's niche
router.get('/', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return }

    let niche = 'general'
    let language = 'Hinglish'

    // Only query DB for real UUID users (not admin special account)
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (UUID_RE.test(req.user.id)) {
      const userRows = await db.select().from(users).where(eq(users.id, req.user.id)).limit(1)
      if (userRows[0]) {
        niche = userRows[0].niche ?? 'general'
        language = userRows[0].preferredLanguage ?? 'Hinglish'
      }
    }

    const trends = await runResearchAgent(niche, language)
    res.json(trends)
  } catch (error) {
    logger.error('GET /trends failed', { error: (error as Error).message })
    res.status(500).json({ error: 'Failed to fetch trends' })
  }
})

// POST /api/v1/trends/refresh — force clear cache and re-fetch
router.post('/refresh', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return }

    let niche = 'general'
    let language = 'Hinglish'

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (UUID_RE.test(req.user.id)) {
      const userRows = await db.select().from(users).where(eq(users.id, req.user.id)).limit(1)
      const user = userRows[0]
      if (!user) { res.status(404).json({ error: 'User not found' }); return }
      niche = user.niche ?? 'general'
      language = user.preferredLanguage ?? 'Hinglish'
    }

    clearTrendCache(niche)

    const trends = await runResearchAgent(niche, language)
    res.json(trends)
  } catch (error) {
    logger.error('POST /trends/refresh failed', { error: (error as Error).message })
    res.status(500).json({ error: 'Failed to refresh trends' })
  }
})

// GET /api/v1/trends/ideas — generate content ideas based on trends + creator profile
router.get('/ideas', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return }

    let niche = 'general'
    let language = 'Hinglish'

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (UUID_RE.test(req.user.id)) {
      const userRows = await db.select().from(users).where(eq(users.id, req.user.id)).limit(1)
      const user = userRows[0]
      if (!user) { res.status(404).json({ error: 'User not found' }); return }
      niche = user.niche ?? 'general'
      language = user.preferredLanguage ?? 'Hinglish'
    }

    // Get creator's style profile
    const profiles = await db.select().from(styleKnowledge).limit(1)
    const profile = profiles[0] ?? {}

    if (!profiles[0]) {
      res.status(400).json({ error: 'Complete training first to get personalised ideas' })
      return
    }

    const trends = await runResearchAgent(niche, language)
    const ideas = await generateContentIdeas(profile, niche, language, trends)

    res.json({ ideas, trends_used: trends.cached_at })
  } catch (error) {
    logger.error('GET /trends/ideas failed', { error: (error as Error).message })
    res.status(500).json({ error: 'Failed to generate ideas' })
  }
})

export default router
