import { db } from '../db'
import {
  trainingContent,
  contentAnalysis,
  styleKnowledge,
  trainingSources,
  userPersonalStyle,
  type TrainingContent,
} from '../db/schema'
import { eq, sql, desc } from 'drizzle-orm'
import { callClaude, parseJsonFromClaude } from '../utils/claude'
import { STYLE_ANALYSIS_PROMPT, MASTER_STYLE_PROMPT } from '../modules/analyzer/analyzer.prompts'
import { logger } from '../utils/logger'
import { callGeminiWithRetry } from '../services/gemini.service'
import { env } from '../config/env'

interface StyleAnalysisResult {
  // Core compatibility fields
  hook_pattern: string
  hook_example: string
  hook_strength: number
  body_structure: string
  transition_phrases: string[]
  cta_pattern: string
  recurring_phrases: string[]
  tone: string
  energy_level: string
  sentence_avg_length: number
  language_mix: string
  example_sentences: string[]
  // 12-attribute deep profile
  hook_type: string
  narrative_structure: string
  idea_style: string
  persona: string
  rhythm_pattern: string
  emotional_arc: string
  power_words: string[]
  pacing_style: string
  signature_patterns: string[]
  // New voice-level fields
  hook_patterns?: Array<{ pattern: string; verbatim_example: string; frequency: string; position: string }>
  sentence_rhythm?: { avg_sentence_length_words: number; rhythm_pattern: string; incomplete_sentence_examples: string[] }
  signature_phrases?: Array<{ phrase: string; context: string }>
  vocabulary?: { signature_words: string[]; english_insertion_rate: number; english_insertion_context: string }
  audience_relationship?: { address_terms: string[]; relationship_type: string; self_deprecation: string }
  reasoning_style?: string
  energy_arc?: string
  cta_patterns?: Array<{ phrase: string; placement: string }>
  content_type?: string
  what_makes_this_creator_unique?: string
}

interface NewMasterStyleResult {
  creator_voice_summary?: string
  core_patterns?: {
    hooks?: Array<{ pattern: string; frequency_pct: number; best_example: string; when_to_use: string }>
    sentence_rhythm?: { avg_length_words: number; rhythm_rule: string; incomplete_sentence_examples: string[] }
    signature_phrases?: string[]
    cta_style?: string
  }
  signature_patterns?: { hooks?: string[]; phrases?: string[]; structural_moves?: string[] }
  occasional_patterns?: { phrases?: string[]; moves?: string[] }
  vocabulary?: {
    must_use_words?: string[]
    must_avoid_words?: string[]
    english_insertion_rate?: number
    english_insertion_rule?: string
  }
  audience_relationship?: { address_terms?: string[]; relationship_type?: string; tone_rule?: string }
  reasoning_arc?: string
  energy_arc?: string
  content_type_variations?: Array<{ content_type: string; hook_preference: string; tone_shift: string; frequency_in_channel?: string }>
  contradictions?: string[]
  evolution_notes?: string
  quality_confidence?: {
    total_videos_analysed: number
    high_confidence_fields: string[]
    low_confidence_fields: string[]
    overall_confidence: string
    confidence_reason?: string
  }
  // Legacy fields for backward compat columns
  best_hooks?: Array<{ pattern: string; example: string; strength: number; when_to_use: string }>
  best_structures?: Array<{ format: string; description: string; best_for: string }>
  best_transitions?: string[]
  best_cta_patterns?: string[]
  vocabulary_bank?: string[]
  example_sentences?: string[]
  tone?: string
  energy_level?: string
  signature_style?: string
  language_patterns?: string
  niche?: string
  hook_types?: string[]
  narrative_structures?: string[]
  idea_styles?: string[]
  persona?: string
  rhythm_profile?: string
  emotional_patterns?: string
  power_words?: string[]
  pacing_style?: string
}

// Recency weighting — videos published more recently count more
function differenceInMonths(now: Date, then: Date): number {
  return (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth())
}

interface ContentAnalysisRecord {
  id: string
  contentId: string
  hookPattern: string | null
  hookStrength: number | null
  bodyStructure: string | null
  transitionPhrases: unknown
  ctaPattern: string | null
  recurringPhrases: unknown
  tone: string | null
  energyLevel: string | null
  sentenceAvgLength: number | null
  language: string | null
  hookType: string | null
  narrativeStructure: string | null
  ideaStyle: string | null
  persona: string | null
  rhythmPattern: string | null
  emotionalArc: string | null
  powerWords: unknown
  pacingStyle: string | null
  signaturePatterns: unknown
  analyzedAt: Date | null
}

interface WeightedAnalysis {
  analysis: ContentAnalysisRecord
  weight: number
  publishedAt: Date
}

function applyRecencyWeights(
  analyses: Array<ContentAnalysisRecord | null | undefined>,
  contents: Array<{ id: string; publishedAt: Date | null }>
): WeightedAnalysis[] {
  const now = new Date()
  const contentDateMap = new Map(contents.map(c => [c.id, c.publishedAt]))

  return analyses
    .filter((a): a is ContentAnalysisRecord => a !== null && a !== undefined)
    .map(analysis => {
      const publishedAt = contentDateMap.get(analysis.contentId) ?? new Date(0)
      const ageMonths = differenceInMonths(now, publishedAt)

      let weight: number
      if (ageMonths <= 6) weight = 1.0
      else if (ageMonths <= 18) weight = 0.7
      else weight = 0.4

      return { analysis, weight, publishedAt }
    })
    .sort((a, b) => b.weight - a.weight || b.publishedAt.getTime() - a.publishedAt.getTime())
}

function getRecencyWeight(publishedAt: Date | string | null): number {
  const now = new Date()
  const published = publishedAt ? new Date(publishedAt) : new Date(0)
  const ageMonths = Math.floor(
    (now.getTime() - published.getTime()) / (1000 * 60 * 60 * 24 * 30)
  )
  if (ageMonths <= 6) return 1.0
  if (ageMonths <= 18) return 0.7
  return 0.4
}

async function buildStyleKnowledgeWithGemini(
  sourceId: string,
  allContent: TrainingContent[],
  analysisMap: Map<string, ContentAnalysisRecord | null>
): Promise<NewMasterStyleResult> {
  const weightedContent = allContent
    .map(c => ({ content: c, weight: getRecencyWeight(c.publishedAt) }))
    .sort((a, b) => b.weight - a.weight || new Date(b.content.scrapedAt ?? 0).getTime() - new Date(a.content.scrapedAt ?? 0).getTime())

  const videosWithTranscripts = weightedContent.filter(wc => wc.content.fullTranscript)
  console.log(`[StyleKnowledge] Total videos: ${allContent.length}`)
  console.log(`[StyleKnowledge] Videos with transcripts: ${videosWithTranscripts.length}`)
  console.log(`[StyleKnowledge] Estimated tokens: ~${videosWithTranscripts.length * 2000}`)
  console.log(`[StyleKnowledge] Using model: gemini-1.5-flash`)

  const fullTranscriptContext = videosWithTranscripts
    .map((wc, index) => {
      const analysis = analysisMap.get(wc.content.id)
      const analysisData = analysis ? {
        hookPattern: analysis.hookPattern,
        hookType: analysis.hookType,
        tone: analysis.tone,
        persona: analysis.persona,
        rhythmPattern: analysis.rhythmPattern,
        emotionalArc: analysis.emotionalArc,
        narrativeStructure: analysis.narrativeStructure,
        voiceAnalysis: analysis.signaturePatterns,
      } : {}
      return `
=== VIDEO ${index + 1} of ${videosWithTranscripts.length} ===
Content Type: ${wc.content.contentType ?? 'unknown'}
Published: ${wc.content.publishedAt ?? wc.content.scrapedAt}
Recency Weight: ${wc.weight} (1.0=recent, 0.4=old)
Transcript Confidence: ${wc.content.confidence ?? 'high'}
Per-Video Analysis:
${JSON.stringify(analysisData, null, 2)}
Transcript:
${wc.content.fullTranscript ?? ''}
=== END VIDEO ${index + 1} ===`
    })
    .join('\n')

  const geminiPrompt = `
You are building a master Style DNA profile for a content creator.
You have been given EVERY video transcript this creator has made —
${videosWithTranscripts.length} videos in total, ordered most recent first.

This is the complete picture. Nothing has been filtered or summarised.
Read everything carefully before building the profile.

Recency weighting rules:
- Videos with weight 1.0 (last 6 months): most important — reflect current style
- Videos with weight 0.7 (6-18 months): important — established patterns
- Videos with weight 0.4 (18+ months): background context — older style

Frequency thresholds:
- CORE pattern: appears in more than 40% of videos — must appear in every script
- SIGNATURE pattern: appears in 20-40% of videos — should appear in most scripts
- OCCASIONAL pattern: appears in less than 20% — use sparingly

Your output must be a single valid JSON object with this exact structure:

{
  "creator_voice_summary": "<3-4 sentences so precise that a writer who has never watched this creator could reproduce their exact voice>",
  "core_patterns": {
    "hooks": [
      {
        "pattern": "<exact structural description>",
        "frequency_pct": 0,
        "best_example": "<verbatim quote from transcripts>",
        "when_to_use": "<which content type or topic this hook fits best>"
      }
    ],
    "sentence_rhythm": {
      "avg_length_words": 0,
      "rhythm_rule": "<specific rule>",
      "incomplete_sentence_examples": ["<verbatim>", "<verbatim>"]
    },
    "signature_phrases": ["<verbatim phrase>"],
    "cta_style": "<exact CTA pattern with verbatim example>"
  },
  "signature_patterns": {
    "hooks": [{"pattern": "<description>", "frequency_pct": 0, "best_example": "<verbatim>"}],
    "phrases": ["<verbatim>"],
    "structural_moves": ["<e.g. self-deprecation before the lesson>"]
  },
  "occasional_patterns": {
    "phrases": ["<verbatim>"],
    "moves": ["<description>"]
  },
  "vocabulary": {
    "must_use_words": ["<word>"],
    "must_avoid_words": ["<formal or corporate words this creator never uses>"],
    "english_insertion_rate": 0.0,
    "english_insertion_rule": "<specific — when exactly do they switch to English>"
  },
  "audience_relationship": {
    "address_terms": ["<yaar>", "<bhai>"],
    "relationship_type": "peer",
    "tone_rule": "<specific tone rule>"
  },
  "reasoning_arc": "<the exact logical journey this creator takes>",
  "energy_arc": "<energy progression>",
  "content_type_variations": [
    {
      "content_type": "tutorial",
      "hook_preference": "<which hook pattern fits this type>",
      "tone_shift": "<how their tone changes>",
      "frequency_in_channel": "<percentage>"
    }
  ],
  "contradictions": ["<specific contradiction>"],
  "evolution_notes": "<how this creator's style has changed from older videos to recent ones>",
  "quality_confidence": {
    "total_videos_analysed": ${videosWithTranscripts.length},
    "high_confidence_fields": ["<fields with strong evidence>"],
    "low_confidence_fields": ["<fields based on fewer than 5 examples>"],
    "overall_confidence": "high",
    "confidence_reason": "<why you gave this confidence level>"
  }
}

STRICT RULES:
1. Every verbatim example must be copied exactly from the transcripts provided
2. Never invent patterns not present in the transcripts
3. If a field has no evidence output null — never guess
4. The evolution_notes field requires comparing early vs recent videos
5. Frequency percentages must be based on actual count across all ${videosWithTranscripts.length} videos
6. For low confidence transcripts (YouTube captions) weight patterns conservatively

Here are all ${videosWithTranscripts.length} video transcripts:

${fullTranscriptContext}
`

  const rawResponse = await callGeminiWithRetry(
    geminiPrompt,
    2,
    `StyleKnowledge build for source ${sourceId}`
  )

  let profile: NewMasterStyleResult
  try {
    profile = JSON.parse(rawResponse) as NewMasterStyleResult
  } catch {
    console.error('[StyleKnowledge] Gemini returned invalid JSON:', rawResponse.slice(0, 500))
    throw new Error('StyleKnowledge build failed — Gemini returned invalid JSON')
  }

  const requiredFields: Array<keyof NewMasterStyleResult> = [
    'creator_voice_summary',
    'core_patterns',
    'vocabulary',
    'audience_relationship',
    'reasoning_arc',
    'energy_arc',
    'quality_confidence',
  ]
  for (const field of requiredFields) {
    if (!profile[field]) {
      throw new Error(`StyleKnowledge missing required field: ${field}`)
    }
  }

  console.log(`[StyleKnowledge] Build complete. Confidence: ${profile.quality_confidence?.overall_confidence}`)
  console.log(`[StyleKnowledge] High confidence fields: ${profile.quality_confidence?.high_confidence_fields?.join(', ')}`)

  return profile
}

export const styleAnalyzerAgent = {
  async analyzeContent(contentId: string): Promise<void> {
    logger.info('StyleAnalyzerAgent starting analysis', { contentId })

    const content = await db.query.trainingContent.findFirst({
      where: eq(trainingContent.id, contentId),
    })

    if (!content) { logger.warn('Content not found', { contentId }); return }
    if (!content.fullTranscript) { logger.debug('No transcript, skipping', { contentId }); return }

    const existingAnalysis = await db.query.contentAnalysis.findFirst({
      where: eq(contentAnalysis.contentId, contentId),
    })
    if (existingAnalysis) { logger.debug('Already analyzed', { contentId }); return }

    try {
      const MAX_CHARS = 10000
      const transcriptSample = content.fullTranscript.length > MAX_CHARS
        ? content.fullTranscript.slice(0, MAX_CHARS) + '\n\n[transcript truncated]'
        : content.fullTranscript

      // Pass transcript confidence to the style analyzer
      const transcriptConfidence = (content as { confidence?: string }).confidence ?? 'high'

      const prompt = STYLE_ANALYSIS_PROMPT(
        transcriptSample,
        content.title ?? 'Unknown Title',
        content.platform ?? 'youtube',
        transcriptConfidence
      )

      const response = await callClaude(prompt, undefined, 3072)
      const a = parseJsonFromClaude<StyleAnalysisResult>(response)

      // Build the full voice analysis object to store as signaturePatterns jsonb
      const voiceAnalysisData = {
        hook_patterns: a.hook_patterns,
        sentence_rhythm: a.sentence_rhythm,
        signature_phrases: a.signature_phrases,
        vocabulary: a.vocabulary,
        audience_relationship: a.audience_relationship,
        reasoning_style: a.reasoning_style,
        energy_arc: a.energy_arc,
        cta_patterns: a.cta_patterns,
        content_type: a.content_type,
        what_makes_this_creator_unique: a.what_makes_this_creator_unique,
        confidence: transcriptConfidence,
      }

      await db.insert(contentAnalysis).values({
        contentId,
        // Original compatibility fields
        hookPattern:      a.hook_pattern,
        hookStrength:     a.hook_strength,
        bodyStructure:    a.body_structure,
        transitionPhrases: a.transition_phrases ?? [],
        ctaPattern:       a.cta_pattern,
        recurringPhrases: a.recurring_phrases ?? [],
        tone:             a.tone,
        energyLevel:      a.energy_level,
        sentenceAvgLength: a.sentence_avg_length,
        language:         content.language,
        // 12-attribute deep profile
        hookType:          a.hook_type,
        narrativeStructure: a.narrative_structure,
        ideaStyle:         a.idea_style ?? a.content_type,
        persona:           a.persona,
        rhythmPattern:     a.rhythm_pattern,
        emotionalArc:      a.emotional_arc ?? a.energy_arc,
        powerWords:        a.power_words ?? a.vocabulary?.signature_words ?? [],
        pacingStyle:       a.pacing_style,
        // Store full new-format voice analysis here
        signaturePatterns: voiceAnalysisData as unknown as string[],
        analyzedAt:        new Date(),
      })

      logger.info('Content analysis stored (voice-level + 12 attributes)', { contentId })
    } catch (error) {
      logger.error('Style analysis failed — counting as done to unblock progress', {
        contentId, error: (error as Error).message,
      })
    }

    // Always increment and check for profile build
    await db
      .update(trainingSources)
      .set({ processedVideos: sql`${trainingSources.processedVideos} + 1`, updatedAt: new Date() })
      .where(eq(trainingSources.id, content.sourceId))

    await this.checkAndBuildMasterProfile(content.sourceId)
  },

  async checkAndBuildMasterProfile(sourceId: string): Promise<void> {
    const source = await db.query.trainingSources.findFirst({
      where: eq(trainingSources.id, sourceId),
    })
    if (!source) return

    const total = source.totalVideos ?? 0
    const processed = source.processedVideos ?? 0

    logger.debug('Analysis progress check', { sourceId, processed, total })

    if (total === 0 || processed < total) return

    await this.buildMasterStyleProfile(sourceId)
  },

  async buildMasterStyleProfile(sourceId: string): Promise<void> {
    console.log(`[StyleKnowledge] Starting build for source: ${sourceId}`)
    logger.info('Building master style profile', { sourceId })

    const source = await db.query.trainingSources.findFirst({
      where: eq(trainingSources.id, sourceId),
    })
    if (!source) return

    // Fetch all content ordered most recent first
    const contents = await db
      .select()
      .from(trainingContent)
      .where(eq(trainingContent.sourceId, sourceId))
      .orderBy(desc(trainingContent.scrapedAt))

    const analyses = await Promise.all(
      contents.map(c => db.query.contentAnalysis.findFirst({
        where: eq(contentAnalysis.contentId, c.id),
      }))
    )

    // Build content→analysis lookup for both paths
    const analysisMap = new Map<string, ContentAnalysisRecord | null>(
      contents.map((c, i) => [c.id, analyses[i] ?? null])
    )

    let m: NewMasterStyleResult
    let builtWithModel = 'claude-sonnet'

    // Primary path: Gemini Flash (1M context — reads ALL transcripts at once)
    if (env.GEMINI_API_KEY) {
      try {
        console.log('[StyleKnowledge] Attempting Gemini Flash build...')
        m = await buildStyleKnowledgeWithGemini(sourceId, contents, analysisMap)
        builtWithModel = 'gemini-1.5-flash'
      } catch (geminiError) {
        logger.warn('[StyleKnowledge] Gemini failed — falling back to Claude Sonnet', {
          sourceId,
          error: (geminiError as Error).message,
        })

        // Fallback: Claude (original implementation — analyses only, no raw transcripts)
        const weightedAnalyses = applyRecencyWeights(
          analyses,
          contents.map(c => ({ id: c.id, publishedAt: c.publishedAt }))
        )
        if (weightedAnalyses.length === 0) {
          logger.warn('No valid analyses found', { sourceId }); return
        }
        const analysesJson = weightedAnalyses.map(wa =>
          JSON.stringify({ weight: wa.weight, publishedAt: wa.publishedAt, ...wa.analysis }, null, 2)
        )
        const prompt = MASTER_STYLE_PROMPT(analysesJson, source.name ?? 'Unknown Creator', weightedAnalyses.length)
        const response = await callClaude(prompt, undefined, 6144)
        m = parseJsonFromClaude<NewMasterStyleResult>(response)
      }
    } else {
      // No Gemini key — use Claude directly
      logger.info('GEMINI_API_KEY not set — using Claude Sonnet for StyleKnowledge build', { sourceId })
      const weightedAnalyses = applyRecencyWeights(
        analyses,
        contents.map(c => ({ id: c.id, publishedAt: c.publishedAt }))
      )
      if (weightedAnalyses.length === 0) {
        logger.warn('No valid analyses found', { sourceId }); return
      }
      const analysesJson = weightedAnalyses.map(wa =>
        JSON.stringify({ weight: wa.weight, publishedAt: wa.publishedAt, ...wa.analysis }, null, 2)
      )
      const prompt = MASTER_STYLE_PROMPT(analysesJson, source.name ?? 'Unknown Creator', weightedAnalyses.length)
      const response = await callClaude(prompt, undefined, 6144)
      m = parseJsonFromClaude<NewMasterStyleResult>(response)
    }

    try {
      const detectedNiche = m.niche ?? source.niche

      const profileData = {
        niche:               detectedNiche,
        platform:            'youtube',
        language:            source.language,
        bestHooks:           m.best_hooks ?? m.core_patterns?.hooks?.map(h => ({
          pattern: h.pattern, example: h.best_example, strength: 8, when_to_use: h.when_to_use
        })) ?? [],
        bestStructures:      m.best_structures ?? [],
        bestCtaPatterns:     m.best_cta_patterns ?? (m.core_patterns?.cta_style ? [m.core_patterns.cta_style] : []),
        bestTransitions:     m.best_transitions ?? [],
        vocabularyBank:      m.vocabulary_bank ?? m.vocabulary?.must_use_words ?? [],
        exampleSentences:    m.example_sentences ?? m.core_patterns?.sentence_rhythm?.incomplete_sentence_examples ?? [],
        hookTypes:           m.hook_types ?? m.core_patterns?.hooks?.map(h => h.pattern) ?? [],
        narrativeStructures: m.narrative_structures ?? [],
        ideaStyles:          m.idea_styles ?? m.content_type_variations?.map(v => v.content_type) ?? [],
        persona:             m.persona ?? m.audience_relationship?.relationship_type ?? '',
        rhythmProfile:       m.rhythm_profile ?? m.core_patterns?.sentence_rhythm?.rhythm_rule ?? '',
        emotionalPatterns:   m.emotional_patterns ?? m.energy_arc ?? '',
        powerWords:          m.power_words ?? m.vocabulary?.must_use_words ?? [],
        pacingStyle:         m.pacing_style ?? '',
        signaturePatterns:   m.signature_patterns?.structural_moves ?? m.signature_patterns?.phrases ?? [],
        tone:                m.tone ?? m.audience_relationship?.tone_rule ?? '',
        energyLevel:         m.energy_level ?? 'medium',
        fullAnalysis:        JSON.stringify(m),
        qualityConfidence:   m.quality_confidence ?? null,
        // Build metadata
        evolutionNotes:      m.evolution_notes ?? null,
        totalVideosAnalysed: m.quality_confidence?.total_videos_analysed ?? contents.length,
        builtWithModel,
        lastUpdated:         new Date(),
      }

      const existing = await db.query.styleKnowledge.findFirst({
        where: eq(styleKnowledge.sourceId, sourceId),
      })
      if (existing) {
        await db.update(styleKnowledge).set(profileData).where(eq(styleKnowledge.sourceId, sourceId))
      } else {
        await db.insert(styleKnowledge).values({ sourceId, ...profileData })
      }

      await db
        .update(trainingSources)
        .set({ status: 'ready', niche: detectedNiche, updatedAt: new Date() })
        .where(eq(trainingSources.id, sourceId))

      logger.info('Master style profile built', { sourceId, builtWithModel })

      if (source.userId) {
        await this.syncToUserPersonalStyle(source.userId, profileData, m)
      }
    } catch (error) {
      logger.error('Failed to build master style profile', { sourceId, error: (error as Error).message })
      throw error
    }
  },

  async syncToUserPersonalStyle(
    userId: string,
    profileData: Record<string, unknown>,
    m: NewMasterStyleResult
  ): Promise<void> {
    logger.info('Syncing style profile to userPersonalStyle', { userId })
    try {
      const styleData = {
        bestHooks:           profileData.bestHooks,
        bestStructures:      profileData.bestStructures,
        bestCtaPatterns:     profileData.bestCtaPatterns,
        bestTransitions:     profileData.bestTransitions,
        vocabularyBank:      profileData.vocabularyBank,
        exampleSentences:    profileData.exampleSentences,
        hookTypes:           profileData.hookTypes,
        narrativeStructures: profileData.narrativeStructures,
        ideaStyles:          profileData.ideaStyles,
        persona:             profileData.persona as string,
        rhythmProfile:       profileData.rhythmProfile as string,
        emotionalPatterns:   profileData.emotionalPatterns as string,
        powerWords:          profileData.powerWords,
        pacingStyle:         profileData.pacingStyle as string,
        signaturePatterns:   profileData.signaturePatterns,
        tone:                profileData.tone as string,
        energyLevel:         profileData.energyLevel as string,
        languageMix:         profileData.language as string,
        signatureStyle:      m.signature_style ?? m.creator_voice_summary ?? '',
        fullAnalysis:        profileData.fullAnalysis as string,
        lastUpdated:         new Date(),
      }

      const existing = await db.query.userPersonalStyle.findFirst({
        where: eq(userPersonalStyle.userId, userId),
      })
      if (existing) {
        await db.update(userPersonalStyle).set(styleData).where(eq(userPersonalStyle.userId, userId))
      } else {
        await db.insert(userPersonalStyle).values({ userId, ...styleData })
      }

      const { users } = await import('../db/schema')
      await db.update(users).set({ trainingStatus: 'ready', updatedAt: new Date() }).where(eq(users.id, userId))

      logger.info('userPersonalStyle synced', { userId })
    } catch (error) {
      logger.error('Failed to sync userPersonalStyle', { userId, error: (error as Error).message })
    }
  },
}
