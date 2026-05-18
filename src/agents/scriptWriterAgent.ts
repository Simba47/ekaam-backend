import { db } from '../db'
import { trainingContent, styleKnowledge, userPersonalStyle } from '../db/schema'
import { eq } from 'drizzle-orm'
import { callGeminiStreaming } from '../services/gemini.service'
import { languageAgent } from './languageAgent'
import { researchAgent } from './researchAgent'
import { qcAgent } from './qcAgent'
import { polishWithSarvam } from '../utils/transcribe'
import { SCRIPT_GENERATION_PROMPT, TrendContext, TranslatedBrandBrief } from '../modules/generator/generator.prompts'
import { logger } from '../utils/logger'

function validateScriptLanguage(script: string, language: string): boolean {
  const lang = language.toLowerCase()
  if (lang === 'tinglish' || lang === 'te-en' || lang === 'tenglish') {
    return !/[ఀ-౿]/.test(script)
  }
  if (lang === 'hinglish' || lang === 'hi-en') {
    return !/[ऀ-ॿ]/.test(script)
  }
  return true
}

export interface ScriptWriterInput {
  sourceId?: string
  userId?: string
  platform: string
  format?: string
  language: string
  topic: string
  durationSeconds: number
  tone: string
  niche?: string
  onChunk?: (chunk: string) => void
  onQcResult?: (scores: object) => void
  onPolished?: (polishedScript: string) => void
  // New: brand video + trend context
  isPromoVideo?: boolean
  brandBrief?: TranslatedBrandBrief
  trendContext?: TrendContext
}

export interface ScriptWriterResult {
  scriptContent: string
  scores: {
    style_match: number
    originality: number
    platform_fit: number
    hook_strength: number
    native_integration?: number
  }
  overallScore: number
  styleProfile: object
}

export const scriptWriterAgent = {
  async run(input: ScriptWriterInput): Promise<ScriptWriterResult> {
    const {
      sourceId,
      userId,
      platform,
      format,
      language,
      topic,
      durationSeconds,
      tone,
      niche,
      onChunk,
      onQcResult,
      onPolished,
      isPromoVideo = false,
      brandBrief,
      trendContext,
    } = input

    logger.info('ScriptWriterAgent starting', { sourceId, userId, platform, topic })

    // 1. Fetch style profile
    let styleProfile: object | null = null
    let creatorLanguage = 'en'

    if (userId) {
      const personalStyle = await db.query.userPersonalStyle.findFirst({
        where: eq(userPersonalStyle.userId, userId),
      })
      if (personalStyle) {
        styleProfile = personalStyle
        creatorLanguage = personalStyle.languageMix ?? 'en'
      }
    }

    if (!styleProfile && sourceId) {
      logger.info('ScriptWriterAgent: fetching style knowledge', { sourceId })
      const knowledge = await db.query.styleKnowledge.findFirst({
        where: eq(styleKnowledge.sourceId, sourceId),
      })
      if (knowledge) {
        let parsed: Record<string, unknown> = { ...knowledge }
        if (knowledge.fullAnalysis && typeof knowledge.fullAnalysis === 'string') {
          try {
            parsed.fullAnalysis = JSON.parse(knowledge.fullAnalysis)
          } catch { /* keep as string if parse fails */ }
        }
        styleProfile = parsed
        creatorLanguage = knowledge.language ?? 'en'
        logger.info('ScriptWriterAgent: style knowledge loaded', { hasProfile: true })
      }
    }

    if (!styleProfile) {
      throw new Error('No style profile found for the given source or user')
    }

    // 2. Fetch relevant past transcripts
    logger.info('ScriptWriterAgent: fetching transcripts')
    const relevantContent = await this.fetchRelevantTranscripts(sourceId, topic, language)
    logger.info('ScriptWriterAgent: transcripts fetched', { count: relevantContent.length })

    // 3. Adapt style to target language
    logger.info('ScriptWriterAgent: adapting style for language', { language })
    const adaptedStyleContext = await languageAgent.adapt({
      styleProfile,
      targetLanguage: language,
      creatorLanguage,
    })
    logger.info('ScriptWriterAgent: language adaptation done')

    // 4. Get trending research context
    logger.info('ScriptWriterAgent: running research')
    const research = await researchAgent.run({
      niche: niche ?? 'general',
      platform,
      language,
    })
    logger.info('ScriptWriterAgent: research done')

    const isJsonContext = typeof adaptedStyleContext === 'string' && adaptedStyleContext.trimStart().startsWith('{')
    const adaptedStyleNotes = isJsonContext ? undefined : adaptedStyleContext

    // 5. Generate script — retry loop using QC regeneration_instructions
    const MAX_ATTEMPTS = 2
    let scriptContent = ''
    let qcResult = {
      pass: false,
      regenerate: true,
      overall_score: 0,
      scores: { style_match: 0, originality: 0, platform_fit: 0, hook_strength: 0 },
      feedback: '',
      regeneration_instructions: null as string | null,
    }
    let regenerationInstructions: string | null = null

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      logger.info(`Script generation attempt ${attempt}/${MAX_ATTEMPTS}`, { topic, platform, format, language })

      const prompt = SCRIPT_GENERATION_PROMPT({
        styleProfile,
        adaptedStyleNotes,
        format,
        relevantTranscripts: relevantContent,
        trendingContext: research.context,
        topic,
        platform,
        language,
        durationSeconds,
        tone,
        // Inject QC feedback from previous attempt
        regenerationInstructions: attempt > 1 ? regenerationInstructions : null,
        improvementFeedback: attempt > 1 ? (regenerationInstructions ?? qcResult.feedback) : undefined,
        // Brand video
        isPromoVideo,
        brandBrief,
        trendContext,
      })

      scriptContent = ''

      const tinglishSystem = language === 'Tinglish'
        ? 'You are a Tinglish script writer. Tinglish means Telugu words written in Roman/English letters mixed with English. ABSOLUTE RULE: Never output Telugu Unicode script characters (అ ఆ ఇ ఈ ఉ చ జ ట ద న మ య ర ల వ శ స హ ళ క గ ఘ ఞ ణ ఒ ఓ ఔ etc.). Write ALL Telugu words phonetically in English letters only. Example: write "idly" not "ఇడ్లీ", "daantho paatu" not "దాంతో పాటు", "macha" not "మాచా". Never use placeholder tags like [word-use-roman].'
        : undefined

      for await (const chunk of callGeminiStreaming(prompt, tinglishSystem)) {
        const cleanChunk = chunk.replace(/\*\*/g, '').replace(/`/g, '')
        scriptContent += cleanChunk
        onChunk?.(cleanChunk)
      }
      // Final pass — strip markdown and Tinglish artifacts
      scriptContent = scriptContent.replace(/\*\*/g, '').replace(/`/g, '')
      if (language === 'Tinglish') {
        scriptContent = scriptContent.replace(/\[([^\]]+)-use-roman\]/g, (_, word) => word)
        scriptContent = scriptContent.replace(/[ఀ-౿]/g, '')
        scriptContent = scriptContent.replace(/  +/g, ' ').trim()
      }

      // Validate no wrong-script characters slipped through
      const isValidScript = validateScriptLanguage(scriptContent, language)
      if (!isValidScript) {
        logger.warn(`Script contains banned Unicode characters for language ${language} — attempt ${attempt}`)
        if (attempt < MAX_ATTEMPTS) {
          regenerationInstructions = `CRITICAL ERROR: Your previous script contained Telugu Unicode characters (\\u0C00-\\u0C7F range). This is strictly forbidden for Tinglish. Rewrite the ENTIRE script using ONLY English/Roman alphabet letters. Every single Telugu word must be spelled phonetically in Roman letters. Not even one Telugu Unicode character is allowed.`
          onChunk?.('\n\n--- Fixing language encoding... ---\n\n')
          continue
        }
      }

      qcResult = await qcAgent.evaluate({
        script: scriptContent,
        styleProfile,
        platform,
        language,
        isPromoVideo,
      })

      onQcResult?.(qcResult.scores)

      logger.info(`QC attempt ${attempt} score: ${qcResult.overall_score}`, {
        scores: qcResult.scores,
        regenerate: qcResult.regenerate,
      })

      if (!qcResult.regenerate || attempt === MAX_ATTEMPTS) break

      // Store regeneration instructions for next attempt
      regenerationInstructions = qcResult.regeneration_instructions
      onChunk?.('\n\n--- Improving script... ---\n\n')
    }

    if (!qcResult.pass) {
      logger.error('Script rejected — failed QC after all attempts', { scores: qcResult.scores })
      throw new Error(
        `Script quality insufficient after ${MAX_ATTEMPTS} attempts. ` +
        `Overall score: ${qcResult.overall_score}. ` +
        `Try a different topic or format.`
      )
    }

    // 6. Polish with Sarvam for local language accuracy
    if (onPolished) {
      logger.info('Polishing script with Sarvam', { language })
      const polished = await polishWithSarvam(scriptContent, language)
      if (polished) {
        logger.info('Sarvam polish complete — sending to client')
        scriptContent = polished
        onPolished(polished)
      }
    }

    return {
      scriptContent,
      scores: qcResult.scores,
      overallScore: qcResult.overall_score,
      styleProfile,
    }
  },

  async fetchRelevantTranscripts(
    sourceId: string | undefined,
    topic: string,
    _language: string
  ): Promise<string[]> {
    if (!sourceId) return []

    const topicWords = topic.toLowerCase().split(/\s+/).filter(w => w.length > 2)

    const allContent = await db.query.trainingContent.findMany({
      where: eq(trainingContent.sourceId, sourceId),
    })

    const scored = allContent
      .filter((c) => c.fullTranscript && c.fullTranscript.length > 50)
      .map((c) => {
        const titleLower = (c.title ?? '').toLowerCase()
        const transcriptLower = (c.fullTranscript ?? '').toLowerCase()
        const score = topicWords.reduce((acc, word) => {
          return (
            acc +
            (titleLower.includes(word) ? 3 : 0) +
            (transcriptLower.includes(word) ? 1 : 0)
          )
        }, 0)
        return { content: c, score }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)

    return scored.map((s) => {
      const c = s.content
      const MAX = 3000
      const excerpt = c.fullTranscript?.slice(0, MAX) ?? ''
      return `Title: ${c.title}\n\n${excerpt}${excerpt.length >= MAX ? '...' : ''}`
    })
  },
}
