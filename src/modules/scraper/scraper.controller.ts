import { Request, Response, NextFunction } from 'express'
import { scraperService } from './scraper.service'

export const scraperController = {
  async getProgress(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const progress = await scraperService.getJobProgress(req.params.sourceId as string)
      res.json({ success: true, data: progress })
    } catch (error) {
      next(error)
    }
  },
}
