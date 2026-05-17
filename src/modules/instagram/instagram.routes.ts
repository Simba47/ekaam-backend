import { Router } from 'express'
import { z } from 'zod'
import { instagramController } from './instagram.controller'
import { authenticate } from '../../middleware/authenticate'
import { authorizeAdmin } from '../../middleware/authorizeAdmin'
import { validate } from '../../middleware/validate'

const router = Router()

const scrapeSchema = z.object({
  url: z.string().url(),
  sourceId: z.string().uuid(),
})

// Admin: scrape Instagram account
router.post(
  '/scrape',
  authenticate,
  authorizeAdmin,
  validate(scrapeSchema),
  instagramController.scrapeAccount
)

// Phase 3: User OAuth flow
router.get('/auth', authenticate, instagramController.oauthRedirect)
router.get('/callback', authenticate, instagramController.oauthCallback)
router.get('/status/:userId', authenticate, instagramController.getTrainingStatus)

export default router
