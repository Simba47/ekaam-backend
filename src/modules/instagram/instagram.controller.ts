import { Request, Response, NextFunction } from 'express'
import { instagramService } from './instagram.service'
import { addInstagramJob } from '../../jobs/queue'
import { db } from '../../db'
import { trainingSources } from '../../db/schema'
import { eq } from 'drizzle-orm'

export const instagramController = {
  async scrapeAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { url, sourceId } = req.body as { url: string; sourceId: string }

      // Mark as processing immediately so the UI reflects queued state
      await db
        .update(trainingSources)
        .set({ status: 'processing', updatedAt: new Date() })
        .where(eq(trainingSources.id, sourceId))

      // Queue the Apify scrape — do NOT await it in the HTTP handler
      await addInstagramJob({ sourceId, accountUrl: url })

      res.json({ success: true, data: { message: 'Instagram scraping queued' } })
    } catch (error) {
      next(error)
    }
  },

  async oauthRedirect(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oauthUrl = instagramService.getOAuthUrl()
      res.redirect(oauthUrl)
    } catch (error) {
      next(error)
    }
  },

  async oauthCallback(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { code } = req.query as { code: string }
      const userId = req.user!.id

      await instagramService.handleOAuthCallback(code, userId)

      // Redirect to client portal
      res.redirect(`${process.env.FRONTEND_CLIENT_URL}/connect-instagram?success=true`)
    } catch (error) {
      next(error)
    }
  },

  async getTrainingStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const status = await instagramService.getTrainingStatus(req.params.userId as string)
      res.json({ success: true, data: status })
    } catch (error) {
      next(error)
    }
  },
}
