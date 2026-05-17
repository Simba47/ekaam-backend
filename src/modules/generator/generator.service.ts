import { orchestrator } from '../../agents/orchestrator'
import { createError } from '../../middleware/errorHandler'
import { db } from '../../db'
import { trainingSources, userPersonalStyle } from '../../db/schema'
import { eq, asc } from 'drizzle-orm'
import { inspirationsService } from '../inspirations/inspirations.service'
import { TrendContext } from '../generator/generator.prompts'
import type { BrandBrief } from '../../agents/brandUSPTranslator.agent'

export interface GenerateScriptDto {
  sourceId?: string
  userId?: string
  inspirationId?: string
  platform: string
  format?: string
  language: string
  topic: string
  targetAudience?: string
  keyMessage?: string
  keyPoints?: string
  additionalInstructions?: string
  durationSeconds: number
  tones: string[]
  niche?: string
  onChunk?: (chunk: string) => void
  onQcResult?: (scores: object) => void
  onPolished?: (polishedScript: string) => void
  saveScript?: boolean
  // Brand video mode
  isPromoVideo?: boolean
  brandBrief?: BrandBrief
  // Selected trend context from /api/v1/trends
  trendContext?: TrendContext
}

export const generatorService = {
  async generate(dto: GenerateScriptDto) {
    // If inspiration selected — use that creator's style 100%
    if (dto.inspirationId && dto.userId) {
      const { style, trainingSourceId } = await inspirationsService.getStyleProfile(dto.inspirationId, dto.userId)
      dto.sourceId = trainingSourceId
      return orchestrator.generateScript(dto)
    }

    if (!dto.sourceId && !dto.userId) throw createError('Either sourceId or userId must be provided', 400)

    if (dto.userId && !dto.sourceId) {
      const personalStyle = await db.query.userPersonalStyle.findFirst({ where: eq(userPersonalStyle.userId, dto.userId) })
      if (!personalStyle) {
        const defaultSource = await db.query.trainingSources.findFirst({ where: eq(trainingSources.status, 'ready'), orderBy: [asc(trainingSources.createdAt)] })
        if (!defaultSource) throw createError('No trained style available yet.', 422)
        dto.sourceId = defaultSource.id
      }
    }

    if (dto.sourceId) {
      const source = await db.query.trainingSources.findFirst({ where: eq(trainingSources.id, dto.sourceId) })
      if (!source) throw createError('Source not found', 404)
      if (source.status !== 'ready') throw createError(`Source not ready. Status: ${source.status}`, 422)
    }

    return orchestrator.generateScript(dto)
  },
}
