import { Request, Response, NextFunction } from 'express'
import { adminService } from './admin.service'
import { authService } from '../auth/auth.service'

const id = (req: Request) => req.params.id as string

export const adminController = {
  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = req.body as { email: string; password: string }
      const result = await authService.adminLogin(email, password)
      res.json({ success: true, data: result })
    } catch (error) {
      next(error)
    }
  },

  async addSource(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const source = await adminService.addSource(req.body)
      res.status(201).json({ success: true, data: source })
    } catch (error) {
      next(error)
    }
  },

  async listSources(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sources = await adminService.listSources()
      res.json({ success: true, data: sources })
    } catch (error) {
      next(error)
    }
  },

  async getSource(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const source = await adminService.getSource(id(req))
      res.json({ success: true, data: source })
    } catch (error) {
      next(error)
    }
  },

  async deleteSource(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await adminService.deleteSource(id(req))
      res.json({ success: true, data: { message: 'Source deleted successfully' } })
    } catch (error) {
      next(error)
    }
  },

  async retrainSource(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await adminService.retrainSource(id(req))
      res.json({ success: true, data: result })
    } catch (error) {
      next(error)
    }
  },

  async buildProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await adminService.buildProfile(id(req))
      res.json({ success: true, data: result })
    } catch (error) {
      next(error)
    }
  },

  async getStyleProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const profile = await adminService.getStyleProfile(id(req))
      res.json({ success: true, data: profile })
    } catch (error) {
      next(error)
    }
  },

  async getSourceContent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const content = await adminService.getSourceContent(id(req))
      res.json({ success: true, data: content })
    } catch (error) {
      next(error)
    }
  },

  async getContentDetail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await adminService.getContentDetail(
        id(req),
        req.params.contentId as string
      )
      res.json({ success: true, data: result })
    } catch (error) {
      next(error)
    }
  },

  async getDashboardStats(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const stats = await adminService.getDashboardStats()
      res.json({ success: true, data: stats })
    } catch (error) {
      next(error)
    }
  },
}
