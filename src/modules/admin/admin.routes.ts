import { Router } from 'express'
import { z } from 'zod'
import { adminController } from './admin.controller'
import { authenticate } from '../../middleware/authenticate'
import { authorizeAdmin } from '../../middleware/authorizeAdmin'
import { validate } from '../../middleware/validate'

const router = Router()

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const addSourceSchema = z.object({
  url: z.string().url('Must be a valid URL'),
  type: z.enum(['youtube_channel', 'youtube_video', 'instagram_account', 'instagram_reel']),
  niche: z.enum([
    'fitness', 'finance', 'tech', 'lifestyle',
    'motivation', 'cooking', 'travel', 'other',
  ]),
  language: z.enum(['en', 'hi', 'te', 'ta', 'kn', 'ml', 'tinglish', 'auto']).optional(),
})

// Public admin login
router.post('/login', validate(loginSchema), adminController.login)

// All other admin routes require auth + admin role
router.use(authenticate, authorizeAdmin)

router.post('/sources', validate(addSourceSchema), adminController.addSource)
router.get('/sources', adminController.listSources)
router.get('/sources/:id', adminController.getSource)
router.delete('/sources/:id', adminController.deleteSource)
router.post('/sources/:id/retrain', adminController.retrainSource)
router.post('/sources/:id/build-profile', adminController.buildProfile)
router.get('/sources/:id/profile', adminController.getStyleProfile)
router.get('/sources/:id/content', adminController.getSourceContent)
router.get('/sources/:id/content/:contentId', adminController.getContentDetail)
router.get('/stats', adminController.getDashboardStats)

export default router
