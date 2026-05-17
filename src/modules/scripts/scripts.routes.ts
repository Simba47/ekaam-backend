import { Router } from 'express'
import { scriptsController } from './scripts.controller'
import { authenticate } from '../../middleware/authenticate'

const router = Router()

router.use(authenticate)

router.get('/', scriptsController.listScripts)
router.get('/my', scriptsController.listMyScripts)
router.get('/stats', scriptsController.getScriptStats)
router.get('/:id', scriptsController.getScript)
router.delete('/:id', scriptsController.deleteScript)

export default router
