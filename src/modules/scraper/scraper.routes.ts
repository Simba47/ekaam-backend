import { Router } from 'express'
import { scraperController } from './scraper.controller'
import { authenticate } from '../../middleware/authenticate'
import { authorizeAdmin } from '../../middleware/authorizeAdmin'

const router = Router()

router.use(authenticate, authorizeAdmin)

router.get('/progress/:sourceId', scraperController.getProgress)

export default router
