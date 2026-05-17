import { Router } from 'express'
import { z } from 'zod'
import { generatorController } from './generator.controller'
import { authenticate } from '../../middleware/authenticate'
import { validate } from '../../middleware/validate'

const router = Router()

const generateSchema = z.object({
  sourceId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  inspirationId: z.string().uuid().optional(),
  platform: z.enum(['youtube', 'instagram_reel', 'podcast', 'ad']).optional(),
  format: z.enum([
    'reel_15', 'reel_60', 'shorts', 'youtube_long',
    'linkedin', 'tiktok', 'podcast', 'ad',
  ]).optional(),
  language: z.string().min(2).max(20),
  topic: z.string().min(3).max(500),
  targetAudience: z.string().max(200).optional(),
  keyMessage: z.string().max(500).optional(),
  keyPoints: z.string().max(1000).optional(),
  additionalInstructions: z.string().max(500).optional(),
  durationSeconds: z.number().int().min(15).max(3600).default(60),
  tones: z.array(z.string()).default(['motivational']),
  tone: z.string().optional(),
  niche: z.string().max(50).optional(),
})

router.use(authenticate)
router.post('/script', validate(generateSchema), generatorController.generateScript)

export default router