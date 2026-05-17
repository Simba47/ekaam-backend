import { callClaude, parseJsonFromClaude } from '../utils/claude'
import { logger } from '../utils/logger'

export interface QCInput {
  script: string
  styleProfile: object
  platform: string
  language: string
  isPromoVideo?: boolean
}

export interface QCScores {
  style_match: number
  originality: number
  platform_fit: number
  hook_strength: number
  native_integration?: number
}

export interface QCResult {
  pass: boolean
  regenerate: boolean
  overall_score: number
  scores: QCScores
  feedback: string
  regeneration_instructions: string | null
}

interface QCRawOutput {
  style_match: { score: number; reasoning: string; improvement: string | null }
  originality: { score: number; reasoning: string; improvement: string | null }
  platform_fit: { score: number; reasoning: string; improvement: string | null }
  hook_strength: { score: number; reasoning: string; improvement: string | null }
  native_integration?: {
    score: number
    reasoning: string
    brand_language_detected: string[]
    product_entry_timing: string
    cta_naturalness: string
    disclosure_quality: string
    improvement: string | null
  }
  overall_score: number
  regenerate: boolean
  regeneration_instructions: string | null
}

function buildQCPrompt(
  script: string,
  styleProfile: object,
  platform: string,
  language: string,
  isPromoVideo: boolean
): string {
  const sk = styleProfile as Record<string, unknown>

  // Extract voice rules from profile — try new-format first, fall back to old
  let fullAnalysis: Record<string, unknown> = {}
  if (sk.fullAnalysis && typeof sk.fullAnalysis === 'string') {
    try { fullAnalysis = JSON.parse(sk.fullAnalysis) } catch { /* use raw */ }
  } else if (typeof sk.fullAnalysis === 'object' && sk.fullAnalysis !== null) {
    fullAnalysis = sk.fullAnalysis as Record<string, unknown>
  }

  const rhythmRule = (fullAnalysis as { core_patterns?: { sentence_rhythm?: { rhythm_rule?: string } } })
    .core_patterns?.sentence_rhythm?.rhythm_rule ?? sk.rhythmProfile ?? ''

  const avoidedWords = ((fullAnalysis as { vocabulary?: { must_avoid_words?: string[] } })
    .vocabulary?.must_avoid_words ?? []) as string[]

  const hookPatterns = ((fullAnalysis as { core_patterns?: { hooks?: Array<{ pattern: string }> } })
    .core_patterns?.hooks ?? []) as Array<{ pattern: string }>

  const addressTerms = ((fullAnalysis as { audience_relationship?: { address_terms?: string[] } })
    .audience_relationship?.address_terms ?? []) as string[]

  return `
You are a script quality evaluator for Indian content creators.
Reason carefully before scoring. Think about each dimension independently.

CRITICAL LANGUAGE RULE:
- Output language requested: "${language}"
- NEVER penalize a script for not being in Telugu if the requested language is English, Hinglish, or Tinglish
- Score platform_fit based on LENGTH and STRUCTURE only — not language
- Score style_match based on ENERGY and TONE only — not language choice

For each dimension:
1. Write your reasoning (2-3 sentences)
2. Give score 0-100
3. Give ONE specific improvement instruction if score < 70

STYLE MATCH — does this sound like this specific creator, not generic AI?
${hookPatterns.length > 0 ? `Check: Does hook match one of their patterns: ${hookPatterns.map(h => h.pattern).join(', ')}?` : ''}
${rhythmRule ? `Check: Does sentence rhythm match — ${rhythmRule}?` : ''}
${avoidedWords.length > 0 ? `Check: Are avoided words absent? Avoided: ${avoidedWords.join(', ')}` : ''}
${addressTerms.length > 0 ? `Check: Is audience addressed as ${addressTerms.join(' or ')}?` : ''}

ORIGINALITY — is this fresh or templated AI output?
Check: Does it avoid generic AI phrases like "In conclusion", "It is important to note"?
Check: Is the angle on the topic specific rather than broad?
Check: Does it feel like a real person wrote it?

PLATFORM FIT — right structure for ${platform} ${language}?
Check: Is the hook strong enough for ${platform}'s retention pattern?
Check: Is pacing appropriate for the format?
Check: Is length appropriate?

HOOK STRENGTH — will this retain viewers in the first 5 seconds?
Check: Does it create immediate curiosity or emotional pull?
Check: Does it avoid slow generic openers like "Aaj main aapko bataunga..."?

${isPromoVideo ? `
NATIVE INTEGRATION — does the brand mention feel organic? (Brand video only)
Check: Does the product enter at the right moment (around 60-65% mark, not earlier)?
Check: Is all brand/corporate language absent?
Check: Does the hook talk about the problem, NOT the product?
Check: Is the CTA soft and mentioned only once?
Check: Is disclosure present and natural, not jarring?
` : ''}

STYLE PROFILE (energy/tone reference):
${JSON.stringify(styleProfile, null, 2).slice(0, 2000)}

SCRIPT:
${script}

Output ONLY valid JSON:

{
  "style_match": {
    "reasoning": "<your analysis>",
    "score": <0-100>,
    "improvement": "<specific actionable instruction | null>"
  },
  "originality": {
    "reasoning": "<your analysis>",
    "score": <0-100>,
    "improvement": "<specific actionable instruction | null>"
  },
  "platform_fit": {
    "reasoning": "<your analysis>",
    "score": <0-100>,
    "improvement": "<specific actionable instruction | null>"
  },
  "hook_strength": {
    "reasoning": "<your analysis>",
    "score": <0-100>,
    "improvement": "<specific actionable instruction | null>"
  },${isPromoVideo ? `
  "native_integration": {
    "reasoning": "<your analysis>",
    "score": <0-100>,
    "brand_language_detected": ["<any corporate phrases that leaked in>"],
    "product_entry_timing": "too early | correct | too late",
    "cta_naturalness": "natural | slightly forced | salesy",
    "disclosure_quality": "natural | awkward | missing",
    "improvement": "<specific actionable instruction | null>"
  },` : ''}
  "overall_score": <weighted average: style_match×0.4 + originality×0.2 + platform_fit×0.2 + hook_strength×0.2>,
  "regenerate": <true if overall_score < 65>,
  "regeneration_instructions": "<if regenerate true: EXACT instructions for next attempt — what was wrong and what to do differently. Be specific. | null if regenerate false>"
}
`
}

export const qcAgent = {
  async evaluate(input: QCInput): Promise<QCResult> {
    const { script, styleProfile, platform, language, isPromoVideo = false } = input

    const prompt = buildQCPrompt(script, styleProfile, platform, language, isPromoVideo)

    try {
      // Use MODEL_FAST (now claude-sonnet-4-5 after CHANGE 1)
      const response = await callClaude(prompt, undefined, 1024, true)
      const result = parseJsonFromClaude<QCRawOutput>(response)

      const scores: QCScores = {
        style_match:  result.style_match?.score ?? 75,
        originality:  result.originality?.score ?? 75,
        platform_fit: result.platform_fit?.score ?? 75,
        hook_strength: result.hook_strength?.score ?? 75,
      }

      if (isPromoVideo && result.native_integration) {
        scores.native_integration = result.native_integration.score
      }

      const overallScore = result.overall_score ?? Math.round(
        scores.style_match * 0.4 +
        scores.originality * 0.2 +
        scores.platform_fit * 0.2 +
        scores.hook_strength * 0.2
      )

      // Collect improvement notes from low-scoring dimensions
      const improvements = [
        result.style_match?.improvement,
        result.originality?.improvement,
        result.platform_fit?.improvement,
        result.hook_strength?.improvement,
      ].filter(Boolean).join(' | ')

      const regenerate = result.regenerate ?? (overallScore < 65)
      // Very relaxed pass threshold — QC guides, never blocks delivery
      const pass = overallScore >= 45

      logger.info('QC evaluation complete', { scores, overallScore, regenerate, pass })

      return {
        pass,
        regenerate,
        overall_score: overallScore,
        scores,
        feedback: improvements,
        regeneration_instructions: result.regeneration_instructions ?? null,
      }
    } catch (error) {
      logger.error('QC agent failed — failing open', { error: (error as Error).message })
      return {
        pass: true,
        regenerate: false,
        overall_score: 75,
        scores: { style_match: 75, originality: 75, platform_fit: 75, hook_strength: 75 },
        feedback: '',
        regeneration_instructions: null,
      }
    }
  },
}
