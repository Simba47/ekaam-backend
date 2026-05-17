import { Request, Response, NextFunction } from 'express'
import { clientTrainingService } from './client-training.service'

const detectUrlType = (url: string): 'youtube_channel' | 'youtube_video' | 'instagram_reel' | 'instagram_account' | null => {
  if (url.includes('instagram.com/reel/') || url.includes('instagram.com/p/')) return 'instagram_reel'
  if (url.includes('instagram.com')) return 'instagram_account'
  if (!url.includes('youtube.com') && !url.includes('youtu.be')) return null
  if (url.includes('youtu.be/') || url.includes('/watch?v=') || url.includes('/shorts/')) return 'youtube_video'
  return 'youtube_channel'
}

export const clientTrainingController = {
  async addSource(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id
      const { url, language, niche } = req.body as { url: string; language?: string; niche?: string }

      const type = detectUrlType(url)
      if (!type) {
        res.status(400).json({ success: false, error: 'Only YouTube channels, YouTube videos, Instagram profiles, and Instagram Reels are supported' })
        return
      }

      const source = await clientTrainingService.addSource(userId, { url, type, language, niche })
      res.status(201).json({ success: true, data: source })
    } catch (err) { next(err) }
  },

  async listSources(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sources = await clientTrainingService.listSources(req.user!.id)
      res.json({ success: true, data: sources })
    } catch (err) { next(err) }
  },

  async getSource(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const source = await clientTrainingService.getSource(req.user!.id, req.params.id as string)
      res.json({ success: true, data: source })
    } catch (err) { next(err) }
  },

  async deleteSource(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await clientTrainingService.deleteSource(req.user!.id, req.params.id as string)
      res.json({ success: true, data: { message: 'Deleted' } })
    } catch (err) { next(err) }
  },

  async retrainSource(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await clientTrainingService.retrainSource(req.user!.id, req.params.id as string)
      res.json({ success: true, data: result })
    } catch (err) { next(err) }
  },

  async rebuildProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await clientTrainingService.rebuildProfile(req.user!.id, req.params.id as string)
      res.json({ success: true, data: result })
    } catch (err) { next(err) }
  },

  async getStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const status = await clientTrainingService.getTrainingStatus(req.user!.id)
      res.json({ success: true, data: status })
    } catch (err) { next(err) }
  },

  async getStyleProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const profile = await clientTrainingService.getStyleProfile(req.user!.id)
      res.json({ success: true, data: profile })
    } catch (err) { next(err) }
  },
}
