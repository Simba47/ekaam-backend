import { Request, Response, NextFunction } from 'express'
import { db } from '../../db'
import { generatedScripts } from '../../db/schema'
import { eq, desc, count } from 'drizzle-orm'
import { createError } from '../../middleware/errorHandler'

export const scriptsController = {
  async listScripts(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const scripts = await db.query.generatedScripts.findMany({
        orderBy: [desc(generatedScripts.createdAt)],
      })
      res.json({ success: true, data: scripts })
    } catch (error) {
      next(error)
    }
  },

  // Returns only scripts belonging to the authenticated user (client portal)
  async listMyScripts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id
      const scripts = await db.query.generatedScripts.findMany({
        where: eq(generatedScripts.userId, userId),
        orderBy: [desc(generatedScripts.createdAt)],
      })
      res.json({ success: true, data: scripts })
    } catch (error) {
      next(error)
    }
  },

  async getScript(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string
      const script = await db.query.generatedScripts.findFirst({
        where: eq(generatedScripts.id, id),
      })

      if (!script) {
        throw createError('Script not found', 404)
      }

      res.json({ success: true, data: script })
    } catch (error) {
      next(error)
    }
  },

  async deleteScript(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params.id as string
      const script = await db.query.generatedScripts.findFirst({
        where: eq(generatedScripts.id, id),
      })

      if (!script) {
        throw createError('Script not found', 404)
      }

      await db.delete(generatedScripts).where(eq(generatedScripts.id, id))

      res.json({ success: true, data: { message: 'Script deleted' } })
    } catch (error) {
      next(error)
    }
  },

  async getScriptStats(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const [totalResult] = await db
        .select({ total: count() })
        .from(generatedScripts)

      const platformCounts = await db
        .select({
          platform: generatedScripts.platform,
          count: count(),
        })
        .from(generatedScripts)
        .groupBy(generatedScripts.platform)

      const languageCounts = await db
        .select({
          language: generatedScripts.language,
          count: count(),
        })
        .from(generatedScripts)
        .groupBy(generatedScripts.language)

      res.json({
        success: true,
        data: {
          total: totalResult.total,
          byPlatform: platformCounts,
          byLanguage: languageCounts,
        },
      })
    } catch (error) {
      next(error)
    }
  },
}
