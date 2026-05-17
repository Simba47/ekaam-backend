import { Request, Response, NextFunction } from 'express'
import { authService } from './auth.service'

export const authController = {
  async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password, name } = req.body as { email: string; password: string; name: string }
      const result = await authService.userRegister(email, password, name)
      res.status(201).json({ success: true, data: result })
    } catch (error) {
      next(error)
    }
  },

  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = req.body as { email: string; password: string }

      // Check if admin login
      let result
      if (email === process.env.ADMIN_EMAIL) {
        result = await authService.adminLogin(email, password)
      } else {
        result = await authService.userLogin(email, password)
      }

      res.json({ success: true, data: result })
    } catch (error) {
      next(error)
    }
  },

  async logout(_req: Request, res: Response): Promise<void> {
    res.json({ success: true, data: { message: 'Logged out' } })
  },

  async me(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id
      const user = await authService.getMe(userId)
      res.json({ success: true, data: user })
    } catch (error) {
      next(error)
    }
  },
}
