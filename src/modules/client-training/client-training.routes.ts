import { Router } from 'express'
import { z } from 'zod'
import { clientTrainingController } from './client-training.controller'
import { authenticate } from '../../middleware/authenticate'
import { validate } from '../../middleware/validate'

const router = Router()
router.use(authenticate)

const addSourceSchema = z.object({
  url: z.string().url('Must be a valid URL'),
  language: z.enum(['en', 'hi', 'te', 'ta', 'kn', 'ml', 'tinglish', 'hinglish', 'auto']).optional(),
  niche: z.enum(['fitness', 'finance', 'tech', 'lifestyle', 'motivation', 'cooking', 'travel', 'other']).optional(),
})

router.get('/status',         clientTrainingController.getStatus)
router.get('/profile',        clientTrainingController.getStyleProfile)
router.get('/',               clientTrainingController.listSources)
router.post('/', validate(addSourceSchema), clientTrainingController.addSource)
router.get('/:id',            clientTrainingController.getSource)
router.delete('/:id',         clientTrainingController.deleteSource)
router.post('/:id/retrain',         clientTrainingController.retrainSource)
router.post('/:id/rebuild-profile', clientTrainingController.rebuildProfile)

export default router
