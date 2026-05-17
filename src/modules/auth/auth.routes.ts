import { Router } from 'express'
import { z } from 'zod'
import { authController } from './auth.controller'
import { validate } from '../../middleware/validate'
import { authenticate } from '../../middleware/authenticate'

const router = Router()

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required'),
})

router.post('/register', validate(registerSchema), authController.register)
router.post('/login', validate(loginSchema), authController.login)
router.post('/logout', authenticate, authController.logout)
router.get('/me', authenticate, authController.me)

export default router
