import { Router } from 'express'
import { inspirationsController } from './inspirations.controller'
import { authenticate } from '../../middleware/authenticate'

const router = Router()
router.use(authenticate)

router.get('/limits', inspirationsController.limits)
router.get('/', inspirationsController.list)
router.post('/', inspirationsController.add)
router.delete('/:id', inspirationsController.remove)

export default router
