import { Request, Response, NextFunction } from 'express'
import { inspirationsService } from './inspirations.service'

export const inspirationsController = {
  async add(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id
      const { url } = req.body as { url: string }
      if (!url) throw new Error('URL is required')
      const result = await inspirationsService.addInspiration(userId, url)
      res.status(201).json({ success: true, data: result })
    } catch (e) { next(e) }
  },

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await inspirationsService.listInspirations(req.user!.id)
      res.json({ success: true, data })
    } catch (e) { next(e) }
  },

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      await inspirationsService.deleteInspiration(req.user!.id, req.params.id)
      res.json({ success: true, data: { message: 'Deleted' } })
    } catch (e) { next(e) }
  },

  async limits(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await inspirationsService.getMonthlyUsage(req.user!.id)
      res.json({ success: true, data })
    } catch (e) { next(e) }
  },
}
