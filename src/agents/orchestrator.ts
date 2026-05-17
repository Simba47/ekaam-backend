import { db } from '../db'
import { generatedScripts } from '../db/schema'
import { scriptWriterAgent } from './scriptWriterAgent'
import { translateBrandUSPs } from './brandUSPTranslator.agent'
import { logger } from '../utils/logger'
import { GenerateScriptDto } from '../modules/generator/generator.service'

export interface GenerateScriptResult {
  id: string
  scriptContent: string
  scores: {
    style_match: number
    originality: number
    platform_fit: number
    hook_strength: number
  }
}

export const orchestrator = {
  async generateScript(input: GenerateScriptDto): Promise<GenerateScriptResult> {
    const {
      sourceId, userId, platform, format, language, topic,
      targetAudience, keyMessage, keyPoints, additionalInstructions,
      durationSeconds, tones, niche, onChunk, onQcResult, onPolished, saveScript = true,
      isPromoVideo = false, brandBrief: rawBrandBrief, trendContext,
    } = input

    logger.info('Orchestrator: starting script generation', { sourceId, userId, platform, topic, isPromoVideo })

    // Build enriched topic string from structured brief
    const enrichedTopic = buildEnrichedTopic({ topic, targetAudience, keyMessage, keyPoints, additionalInstructions })

    // Translate brand USPs into creator voice if brand video mode
    let translatedBrandBrief: import('./brandUSPTranslator.agent').TranslatedBrandBrief | undefined
    if (isPromoVideo && rawBrandBrief) {
      try {
        // We need the style profile to translate USPs — fetch it first
        const { styleKnowledge, userPersonalStyle } = await import('../db/schema')
        const { eq } = await import('drizzle-orm')
        let styleProfile: object = {}

        if (userId) {
          const ps = await db.query.userPersonalStyle.findFirst({ where: eq(userPersonalStyle.userId, userId) })
          if (ps) styleProfile = ps
        } else if (sourceId) {
          const sk = await db.query.styleKnowledge.findFirst({ where: eq(styleKnowledge.sourceId, sourceId) })
          if (sk) styleProfile = sk
        }

        translatedBrandBrief = await translateBrandUSPs(rawBrandBrief, styleProfile)
        logger.info('Brand USPs translated', { brand: rawBrandBrief.brandName })
      } catch (err) {
        logger.warn('Brand USP translation failed — using raw brief', { error: (err as Error).message })
      }
    }

    const result = await scriptWriterAgent.run({
      sourceId,
      userId,
      platform,
      format,
      language,
      topic: enrichedTopic,
      durationSeconds,
      tone: tones.join(', '),
      niche,
      onChunk,
      onQcResult,
      onPolished,
      isPromoVideo,
      brandBrief: translatedBrandBrief,
      trendContext,
    })

    if (!saveScript) {
      return { id: 'preview', scriptContent: result.scriptContent, scores: result.scores }
    }

    const [saved] = await db
      .insert(generatedScripts)
      .values({
        sourceId,
        userId,
        platform,
        format,
        niche,
        language,
        topic,
        targetAudience,
        keyMessage,
        keyPoints,
        additionalInstructions,
        durationSeconds,
        tone: tones.join(', '),
        scriptContent: result.scriptContent,
        styleMatchScore: result.scores.style_match,
        originalityScore: result.scores.originality,
        platformFitScore: result.scores.platform_fit,
        hookStrengthScore: result.scores.hook_strength,
        sourcesUsed: sourceId ? [sourceId] : [],
        createdAt: new Date(),
        isPromoVideo: isPromoVideo ? 'true' : 'false',
        brandName: rawBrandBrief?.brandName ?? null,
        nativeIntegrationScore: result.scores.native_integration ?? null,
      })
      .returning()

    logger.info('Script saved', { scriptId: saved.id })
    return { id: saved.id, scriptContent: result.scriptContent, scores: result.scores }
  },
}

function buildEnrichedTopic(params: {
  topic: string
  targetAudience?: string
  keyMessage?: string
  keyPoints?: string
  additionalInstructions?: string
}): string {
  const parts = [`Topic: ${params.topic}`]
  if (params.targetAudience) parts.push(`Target Audience: ${params.targetAudience}`)
  if (params.keyMessage) parts.push(`Key Message: ${params.keyMessage}`)
  if (params.keyPoints) parts.push(`Key Points to Cover:\n${params.keyPoints}`)
  if (params.additionalInstructions) parts.push(`Additional Instructions: ${params.additionalInstructions}`)
  return parts.join('\n')
}
