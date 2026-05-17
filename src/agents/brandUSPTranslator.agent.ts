import Anthropic from '@anthropic-ai/sdk'
import { env } from '../config/env'

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

export interface BrandBrief {
  brandName: string
  productName: string
  rawUSPs: string
  cta: string
  restrictions: string
  integrationStyle: 'story-first' | 'tutorial' | 'review' | 'challenge'
  disclosurePreference: 'natural' | 'formal'
}

export interface TranslatedBrandBrief extends BrandBrief {
  translatedUSPs: Array<{
    original: string
    translated: string
    proof_point: string
  }>
  story_angle: string
  natural_entry_line: string
  disclosureText: string
  hookDuration: number
}

const DISCLOSURE_TEMPLATES: Record<string, string[]> = {
  peer: [
    'Yeh video {brand} ke saath mil ke banaya hai — genuinely use karta hoon main',
    '{brand} ne sponsor kiya hai, but yeh mera apna experience hai',
  ],
  mentor: [
    'Full transparency — {brand} ke saath collaboration hai, isliye share kar raha hoon',
    'Paid partnership hai {brand} ke saath — opinion mera apna hai',
  ],
  friend: [
    'BTW — {brand} ke saath paid collab hai yeh, link bio mein hai',
    'Yeh {brand} collaboration hai — genuinely helpful laga isliye bata raha hoon',
  ],
  expert: [
    'Disclosure: {brand} ke saath sponsored content hai — analysis meri apni hai',
  ],
}

export async function translateBrandUSPs(
  brief: BrandBrief,
  styleKnowledge: object
): Promise<TranslatedBrandBrief> {
  const sk = styleKnowledge as Record<string, unknown>

  // Try to get voice data from new-format fullAnalysis
  let fullAnalysis: Record<string, unknown> = {}
  if (sk.fullAnalysis && typeof sk.fullAnalysis === 'string') {
    try { fullAnalysis = JSON.parse(sk.fullAnalysis) } catch { /* ignore */ }
  } else if (sk.fullAnalysis && typeof sk.fullAnalysis === 'object') {
    fullAnalysis = sk.fullAnalysis as Record<string, unknown>
  }

  const vocab = (fullAnalysis as { vocabulary?: { must_avoid_words?: string[] } }).vocabulary
  const audience = (fullAnalysis as { audience_relationship?: { relationship_type?: string } }).audience_relationship
  const voiceSummary = (fullAnalysis as { creator_voice_summary?: string }).creator_voice_summary
    ?? (sk.signatureStyle as string | undefined)
    ?? ''

  const avoidedWords = vocab?.must_avoid_words?.join(', ') ?? ''
  const relationshipType = audience?.relationship_type ?? 'friend'

  const prompt = `
You are translating brand marketing language into a specific creator's
natural speaking voice.

Creator voice profile:
- Voice summary: ${voiceSummary}
- Audience relationship: ${relationshipType}
- Words they NEVER use: ${avoidedWords}

Brand USPs to translate (these are in corporate/marketing language):
${brief.rawUSPs}

Brand: ${brief.brandName}
Product: ${brief.productName}

For each USP:
1. Understand what it actually means to a real user
2. Rewrite it as a personal observation in this creator's exact voice
3. Make it specific and experiential — not vague

Output ONLY this JSON:
{
  "translated_usps": [
    {
      "original": "<brand's marketing language>",
      "translated": "<in creator's exact voice — personal observation>",
      "proof_point": "<how this creator would personally demonstrate this benefit>"
    }
  ],
  "story_angle": "<the personal problem or situation that this brand genuinely solves — must feel real>",
  "natural_entry_line": "<the exact transition sentence where the product enters most naturally>"
}
`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  })

  const textContent = response.content.find(b => b.type === 'text')
  const raw = JSON.parse(textContent?.type === 'text' ? textContent.text : '{}')

  const relType = relationshipType as keyof typeof DISCLOSURE_TEMPLATES
  const templates = DISCLOSURE_TEMPLATES[relType] ?? DISCLOSURE_TEMPLATES.friend
  const disclosureText = templates[0].replace('{brand}', brief.brandName)

  return {
    ...brief,
    translatedUSPs: raw.translated_usps ?? [],
    story_angle: raw.story_angle ?? '',
    natural_entry_line: raw.natural_entry_line ?? '',
    disclosureText,
    hookDuration: brief.integrationStyle === 'story-first' ? 15 : 10,
  }
}
