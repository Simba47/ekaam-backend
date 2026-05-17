export interface TrendContext {
  trending_reason: string
  current_affair_tie_in: string | null
  audience_pulse: string
  urgency_factor: string
  hashtags: string[]
  gap_opportunity: string | null
}

export interface TranslatedBrandBrief {
  brandName: string
  productName: string
  rawUSPs: string
  cta: string
  restrictions: string
  integrationStyle: string
  disclosurePreference: string
  translatedUSPs: Array<{ original: string; translated: string; proof_point: string }>
  story_angle: string
  natural_entry_line: string
  disclosureText: string
  hookDuration: number
}

export interface ScriptGenerationInput {
  styleProfile: object
  relevantTranscripts: string[]
  trendingContext: string
  topic: string
  platform: string
  format?: string
  language: string
  durationSeconds: number
  tone: string
  improvementFeedback?: string
  adaptedStyleNotes?: string
  // New fields for CHANGE 4 & 7
  trendContext?: TrendContext
  isPromoVideo?: boolean
  brandBrief?: TranslatedBrandBrief
  regenerationInstructions?: string | null
}

const FORMAT_RULES: Record<string, string> = {
  reel_15: `FORMAT: Instagram Reel (15-30 seconds)
- Hook MUST land in the FIRST 2 seconds — one punchy sentence only
- Total script: 40-60 words maximum
- Structure: [HOOK] [ONE POINT] [CTA]
- Every sentence max 6 words
- CTA: 5 words or less
- Energy: MAXIMUM — urgent, scroll-stopping`,

  reel_60: `FORMAT: Instagram Reel (30-60 seconds)
- Hook MUST land in the first 3 seconds — no buildup
- Total script: 80-120 words maximum
- Structure: [HOOK] [BODY - 3 quick points] [CTA]
- Sentences must be SHORT — maximum 8 words each
- CTA: one clear action, maximum 10 words
- Energy: HIGH throughout`,

  shorts: `FORMAT: YouTube Shorts (60 seconds)
- Hook in first 3 seconds — question or bold statement
- Total script: 120-150 words
- Structure: [HOOK] [QUICK VALUE - 3 points] [CTA]
- Fast paced, punchy delivery
- End with subscribe-style CTA`,

  youtube_long: `FORMAT: YouTube Long Form (5-10 minutes)
- Hook in first 15 seconds — promise value immediately
- Structure: [HOOK] [INTRO] [MAIN CONTENT - 3-5 sections] [OUTRO] [CTA]
- Detailed, educational, conversational
- Include section transitions
- Target 700-1200 words
- CTA: subscribe, comment, or watch next`,

  linkedin: `FORMAT: LinkedIn Video Post
- Professional yet personable opening
- Structure: [HOOK - bold insight] [STORY/DATA] [LESSON] [CTA]
- Target 90-120 seconds (200-250 words)
- Tone: thought leadership
- End with a question to drive comments`,

  tiktok: `FORMAT: TikTok Video (15-60 seconds)
- INSTANT hook — first word must grab attention
- Structure: [HOOK] [VALUE] [CTA]
- Conversational, relatable, raw energy
- Target 60-100 words
- CTA: follow for more`,

  podcast: `FORMAT: Podcast Episode
- Warm conversational opening
- Structure: [OPENING] [INTRO] [MAIN DISCUSSION] [KEY TAKEAWAYS] [CLOSE]
- Deep dives — full detail, no visual references
- Natural pauses in script
- Close with memorable thought`,

  ad: `FORMAT: Advertisement Script
- Every word must earn its place
- Structure: [HOOK] [PROBLEM] [SOLUTION] [PROOF] [CTA]
- Maximum urgency — create FOMO
- Problem must feel real and relatable
- CTA: crystal clear with one action`,

  // legacy fallbacks
  youtube: `FORMAT: YouTube Video
- Hook in first 15 seconds — promise value immediately
- Structure: [HOOK] [INTRO] [MAIN CONTENT] [OUTRO] [CTA]
- Vary sentence length, include transitions
- CTA: subscribe, comment, or watch next`,

  instagram_reel: `FORMAT: Instagram Reel (60 seconds)
- Hook MUST land in the first 3 seconds
- Structure: [HOOK] [BODY] [CTA]
- Short punchy sentences — max 8 words
- Energy: HIGH throughout`,
}

const TONE_RULES: Record<string, string> = {
  energetic:     'Explosive energy. Short punchy sentences. Fast pacing. Every line has momentum.',
  professional:  'Polished, authoritative. Well-structured arguments. Credibility through data and expertise.',
  funny:         'Use humor naturally — self-deprecating jokes, relatable situations, witty observations. Never forced.',
  inspirational: 'Uplifting and empowering. Paint vivid pictures of possibility. Make the viewer believe in themselves.',
  educational:   'Clear explanations. Break complex ideas into simple steps. Use analogies and real examples.',
  storytelling:  'Open with a story or scene. Build tension, reveal insight, close with lesson. Narrative arc.',
  controversial: 'Take a bold contrarian stance. Challenge conventional wisdom. Spark debate respectfully.',
  emotional:     'Connect deeply. Vulnerability, empathy, shared human experience. Make them feel something real.',
  motivational:  'Drive action through inspiration. Bold statements, powerful questions, call to greatness.',
  casual:        'Relaxed, like talking to a close friend. Conversational language, natural flow, approachable.',
  direct:        'Get straight to the point. No fluff. Respect the viewer\'s time. Facts and action only.',
}

// Strip Telugu script characters from vocab — for Tinglish generation
const TELUGU_SCRIPT_REGEX = /[\u0C00-\u0C7F]+/g

function sanitizeForTinglish(profile: object): object {
  const json = JSON.stringify(profile)
  const sanitized = json.replace(TELUGU_SCRIPT_REGEX, (match) => `[${match}-use-roman]`)
  try { return JSON.parse(sanitized) } catch { return profile }
}

// Pull structured fields out of the profile object — handles both camelCase and snake_case keys
function extractProfileFields(raw: object) {
  const p = raw as Record<string, unknown>

  // fullAnalysis may be stored as a JSON string — parse it
  let fullAnalysis: Record<string, unknown> = {}
  if (p.fullAnalysis) {
    if (typeof p.fullAnalysis === 'string') {
      try { fullAnalysis = JSON.parse(p.fullAnalysis) } catch { /* ignore */ }
    } else if (typeof p.fullAnalysis === 'object') {
      fullAnalysis = p.fullAnalysis as Record<string, unknown>
    }
  }

  return {
    bestHooks:       (p.bestHooks       ?? p.best_hooks        ?? []) as Array<{ pattern: string; example: string; strength: number; when_to_use: string }>,
    bestStructures:  (p.bestStructures  ?? p.best_structures   ?? []) as Array<{ format: string; description: string; best_for: string }>,
    bestTransitions: (p.bestTransitions ?? p.best_transitions  ?? []) as string[],
    bestCtaPatterns: (p.bestCtaPatterns ?? p.best_cta_patterns ?? []) as string[],
    vocabularyBank:  (p.vocabularyBank  ?? p.vocabulary_bank   ?? []) as string[],
    exampleSentences:(p.exampleSentences ?? p.example_sentences ?? []) as string[],
    tone:            (p.tone ?? '') as string,
    energyLevel:     (p.energyLevel ?? p.energy_level ?? 'medium') as string,
    niche:           (p.niche ?? '') as string,
    signatureStyle:  (fullAnalysis.signature_style  ?? p.signatureStyle  ?? '') as string,
    languagePatterns:(fullAnalysis.language_patterns ?? p.languagePatterns ?? '') as string,
  }
}

// Extract new-format profile from fullAnalysis if present
function extractNewFormatProfile(styleProfile: object): Record<string, unknown> | null {
  const p = styleProfile as Record<string, unknown>
  let fa: Record<string, unknown> = {}
  if (p.fullAnalysis && typeof p.fullAnalysis === 'string') {
    try { fa = JSON.parse(p.fullAnalysis) } catch { return null }
  } else if (p.fullAnalysis && typeof p.fullAnalysis === 'object') {
    fa = p.fullAnalysis as Record<string, unknown>
  }
  return fa.creator_voice_summary ? fa : null
}

// Build identity-lock section for new-format profiles (CHANGE 4)
function buildIdentityLockSection(nf: Record<string, unknown>): string {
  const sk = nf as {
    creator_voice_summary?: string
    core_patterns?: {
      hooks?: Array<{ pattern: string }>
      sentence_rhythm?: { rhythm_rule: string; incomplete_sentence_examples: string[] }
      signature_phrases?: string[]
      cta_style?: string
    }
    vocabulary?: { must_use_words?: string[]; must_avoid_words?: string[]; english_insertion_rule?: string }
    audience_relationship?: { address_terms?: string[]; relationship_type?: string; tone_rule?: string }
    reasoning_arc?: string
    energy_arc?: string
    signature_patterns?: { phrases?: string[]; structural_moves?: string[] }
    occasional_patterns?: { phrases?: string[]; moves?: string[] }
    contradictions?: string[]
  }

  const mustAvoid = sk.vocabulary?.must_avoid_words?.join(', ') ?? ''
  const mustUse = sk.vocabulary?.must_use_words?.join(', ') ?? ''
  const addressTerms = sk.audience_relationship?.address_terms?.join(', ') ?? ''
  const hookPatterns = sk.core_patterns?.hooks?.map(h => h.pattern).join('\n   - ') ?? ''
  const rhythmRule = sk.core_patterns?.sentence_rhythm?.rhythm_rule ?? ''
  const incompleteExamples = sk.core_patterns?.sentence_rhythm?.incomplete_sentence_examples?.join(', ') ?? ''

  return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IDENTITY LOCK — YOU ARE THIS CREATOR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You ARE this creator. You are not an AI writing like them. You ARE them.

Your voice in one paragraph:
${sk.creator_voice_summary ?? ''}

YOUR CORE RULES — NON-NEGOTIABLE IN EVERY SCRIPT:
${hookPatterns ? `1. Hooks you use:\n   - ${hookPatterns}` : ''}
${rhythmRule ? `2. Sentence rhythm: ${rhythmRule}` : ''}
${incompleteExamples ? `   Your natural incomplete sentences: ${incompleteExamples}` : ''}
${mustUse ? `3. Words you always use: ${mustUse}` : ''}
${mustAvoid ? `4. Words you NEVER use: ${mustAvoid}` : ''}
${sk.vocabulary?.english_insertion_rule ? `5. English insertion rule: ${sk.vocabulary.english_insertion_rule}` : ''}
${addressTerms ? `6. How you address your audience: ${addressTerms}` : ''}
${sk.reasoning_arc ? `7. Your reasoning arc: ${sk.reasoning_arc}` : ''}
${sk.energy_arc ? `8. Your energy: ${sk.energy_arc}` : ''}
${sk.core_patterns?.cta_style ? `9. Your CTA style: ${sk.core_patterns.cta_style}` : ''}

${sk.signature_patterns?.phrases?.length || sk.signature_patterns?.structural_moves?.length ? `YOUR SIGNATURE MOVES (use most of the time):
Phrases: ${sk.signature_patterns?.phrases?.join(', ') ?? 'none'}
Structural moves: ${sk.signature_patterns?.structural_moves?.join(' | ') ?? 'none'}` : ''}

${sk.occasional_patterns?.phrases?.length || sk.occasional_patterns?.moves?.length ? `YOUR OCCASIONAL MOVES (sprinkle in for authenticity):
Phrases: ${sk.occasional_patterns?.phrases?.join(', ') ?? 'none'}
Moves: ${sk.occasional_patterns?.moves?.join(' | ') ?? 'none'}` : ''}

${sk.contradictions?.length ? `IMPORTANT VARIATIONS:
${sk.contradictions.join('\n')}` : ''}
`
}

// Build brand video instructions section (CHANGE 7)
function buildBrandVideoSection(brandBrief: TranslatedBrandBrief): string {
  return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BRAND VIDEO INSTRUCTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You have been paid to feature ${brandBrief.brandName} in this video.
Make this feel completely authentic — because you genuinely find this product useful.

Brand: ${brandBrief.brandName}
Product: ${brandBrief.productName}
Translated USPs (already in your voice — use these, not the brand's language):
${JSON.stringify(brandBrief.translatedUSPs, null, 2)}
Required CTA: ${brandBrief.cta}
Do NOT say or imply: ${brandBrief.restrictions}
Disclosure (ASCI India required): ${brandBrief.disclosureText}

SCRIPT STRUCTURE FOR BRAND VIDEO (follow this exactly):
1. HOOK (first ${brandBrief.hookDuration}s): Talk about the PROBLEM. No brand mention yet.
2. BUILD (until 60% through): Deepen the problem. Creator's struggle/curiosity. Still no brand.
3. NATURAL ENTRY (around 60-65% mark): Product enters as something you found/tried.
   Frame as personal discovery — "Maine try kiya" not "Today's video is sponsored by"
4. VALUE PROOF (65-80%): 1-2 specific benefits in YOUR words. No brand copy.
5. SOFT CTA + DISCLOSURE (80-100%): Recommendation style. Disclosure natural. CTA once only.

NEVER use: amazing, incredible, game-changer, industry-leading, award-winning,
or any word that sounds like it came from a press release.
Story angle: ${brandBrief.story_angle}
Natural entry line: ${brandBrief.natural_entry_line}
`
}

export const SCRIPT_GENERATION_PROMPT = (input: ScriptGenerationInput): string => {
  const tones = input.tone.split(', ').filter(Boolean)
  const toneInstructions = tones
    .map(t => TONE_RULES[t] ?? '')
    .filter(Boolean)
    .map((rule, i) => `${i + 1}. ${rule}`)
    .join('\n')

  const formatKey = input.format ?? input.platform
  const platformRules = FORMAT_RULES[formatKey] ?? FORMAT_RULES[input.platform] ?? FORMAT_RULES.youtube

  // Sanitize Telugu script from profile when writing Tinglish
  const rawProfile = input.language === 'Tinglish'
    ? sanitizeForTinglish(input.styleProfile)
    : input.styleProfile

  // Check if this profile has the new voice-level format
  const newFormatProfile = extractNewFormatProfile(rawProfile)

  const {
    bestHooks, bestStructures, bestTransitions, bestCtaPatterns,
    vocabularyBank, exampleSentences, tone, energyLevel,
    signatureStyle, languagePatterns,
  } = extractProfileFields(rawProfile)

  // ── Language rules ─────────────────────────────────────────────────────────
  const languageRules = input.language === 'Tinglish'
    ? `TINGLISH — MANDATORY RULES:

❌ ZERO Telugu script characters (అ ఆ ఇ ఈ చేయి మన etc.) — INSTANT FAIL if any appear
✅ ALL Telugu words written phonetically in Roman/English letters

HOW IT WORKS:
Telugu spoken words spelled in Roman letters + English words mixed naturally.
This is exactly how Telugu creators type to their fans.

EXAMPLE SENTENCES (match this exact style):
  "Mee life lo oka chinna change cheyyandi — results chustaru"
  "Idi chadivina tarvata, mee thinking completely shift avutundi"
  "Chala mandi ki telidhu... but idi truth"
  "Oka pani cheyyadam mano cheskovaddu, consistency important"
  "Meeru daily 5 minutes invest chesthe, life maaruthundi guaranteed"
  "Simple ga cheppali ante — focus lekunte results raavu"
  "Ikkade chala mandi fail avutunnaru ento telusaa? Because they don't have a system"

RATIO: ~60% Telugu words (Roman letters) + ~40% English
Telugu script examples → Roman: "చేయి"→"cheyi"  "మనం"→"manam"  "ఇది"→"idi"  "ఎందుకు"→"enduku"`

    : input.language === 'Hinglish'
    ? `HINGLISH — Mix Hindi (Devanagari) + English naturally.
Hindi words for emotional/cultural concepts, English for technical/modern terms.
Natural code-switching like Indian creators do.`

    : input.language === 'English'
    ? `ENGLISH — MANDATORY RULES:
Write 100% in English. 
Do NOT use any Telugu script characters (అ ఆ ఇ etc.).
Do NOT use any Telugu words (even romanized) unless the topic demands it.
The creator's style = energy, tone, rhythm, conversational flair — NOT their language.
Adapt their PERSONALITY into English. Sound like them but speak English.`

    : `Write entirely in: ${input.language}
Use the creator's natural language patterns and energy.`

  // ── Sections built from actual profile data ────────────────────────────────
  const hooksSection = bestHooks.length > 0
    ? bestHooks
        .sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0))
        .map((h, i) =>
          `${i + 1}. [${h.strength ?? '?'}/10] ${h.pattern}\n` +
          `   Example: "${h.example}"\n` +
          `   Use when: ${h.when_to_use}`
        ).join('\n\n')
    : '(Use the creator\'s natural opening style — study the examples below)'

  const structuresSection = bestStructures.length > 0
    ? bestStructures.map(s => `• ${s.format}: ${s.description}  →  Best for: ${s.best_for}`).join('\n')
    : '(Follow the format rules)'

  const transitionsSection = bestTransitions.length > 0
    ? bestTransitions.map(t => `  • "${t}"`).join('\n')
    : '(Use natural connectors)'

  const ctaSection = bestCtaPatterns.length > 0
    ? bestCtaPatterns.map(c => `  • "${c}"`).join('\n')
    : '(Use the creator\'s natural call-to-action style)'

  const vocabSection = vocabularyBank.length > 0
    ? vocabularyBank.join(' · ')
    : '(Use vocabulary from the example transcripts)'

  const examplesSection = exampleSentences.length > 0
    ? exampleSentences.map(s => `  "${s}"`).join('\n')
    : ''

  const energyInstruction = {
    high:   'HIGH ENERGY: Fast pacing, urgency, short punchy sentences. Every line has drive.',
    medium: 'MEDIUM ENERGY: Natural conversational flow. Balanced pacing. Relatable.',
    low:    'LOW ENERGY: Calm, thoughtful, measured. Every word deliberate.',
  }[energyLevel.toLowerCase()] ?? 'Match the creator\'s natural energy from the examples.'

  return `You are the world's best script ghostwriter. Your job: write a script so authentic it sounds like the creator wrote it themselves.

RULE #1: Sound EXACTLY like this creator. NOT generic. NOT template-like. THEM.
RULE #2: Completely original — zero copied sentences from past content.
RULE #3: Start writing immediately. No preamble. No "Here is the script:".
${newFormatProfile ? buildIdentityLockSection(newFormatProfile) : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LANGUAGE: READ THIS FIRST — MANDATORY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${languageRules}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHO IS THIS CREATOR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tone: ${tone}
Energy: ${energyInstruction}
${signatureStyle ? `Signature Style: ${signatureStyle}` : ''}
${languagePatterns ? `Language Patterns: ${languagePatterns}` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROVEN HOOK PATTERNS (USE ONE OF THESE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${hooksSection}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTENT STRUCTURES THAT WORK FOR THEM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${structuresSection}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THEIR SIGNATURE TRANSITION PHRASES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Use these to connect ideas — don't use generic transitions:
${transitionsSection}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THEIR CALL-TO-ACTION PATTERNS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
End with one of these (or a variation):
${ctaSection}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VOCABULARY BANK — USE THESE WORDS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Weave these in naturally — they are this creator's signature words:
${vocabSection}
${examplesSection ? `\nExample sentences in their voice:\n${examplesSection}` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PAST CONTENT — STUDY STYLE, DO NOT COPY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${input.relevantTranscripts.length > 0
  ? input.relevantTranscripts.map((t, i) => `--- Video ${i + 1} ---\n${t}`).join('\n\n')
  : '(No past content available — rely entirely on the style data above)'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCRIPT BRIEF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${input.topic}

Target Duration: ${input.durationSeconds} seconds
${input.trendingContext ? `\nTRENDING CONTEXT (use for relevance + originality):
${input.trendingContext}` : ''}

${input.trendContext ? `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CURRENT MOMENT — WHY THIS FEELS TIMELY TODAY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Why this topic is relevant right now: ${input.trendContext.trending_reason}
${input.trendContext.current_affair_tie_in ? `Current event you can reference naturally: ${input.trendContext.current_affair_tie_in}` : ''}
What your audience is feeling: ${input.trendContext.audience_pulse}
${input.trendContext.gap_opportunity ? `Unique angle no other creator has covered: ${input.trendContext.gap_opportunity}` : ''}
Why this needs to feel like today, not last month: ${input.trendContext.urgency_factor}

` : ''}${input.isPromoVideo && input.brandBrief ? buildBrandVideoSection(input.brandBrief) : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMAT RULES — FOLLOW EXACTLY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${platformRules}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TONE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${toneInstructions || `Match the creator's natural ${tone} energy exactly.`}

${input.adaptedStyleNotes ? `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LANGUAGE ADAPTATION NOTES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${input.adaptedStyleNotes}

` : ''}${input.regenerationInstructions || input.improvementFeedback ? `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PREVIOUS ATTEMPT FEEDBACK — FIX THESE SPECIFICALLY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${input.regenerationInstructions ?? input.improvementFeedback}

` : ''}Now write the script. Sound like them. Be specific. Be original.${input.language === 'Tinglish' ? '\nZERO Telugu script characters — Roman letters only for Telugu words.' : ''}
`
}

export const QC_PROMPT = (script: string, styleProfile: string, platform: string, language?: string): string => `
You are a strict script quality evaluator. Score honestly — average scripts score 5-6, great scripts 8-9.

CREATOR STYLE PROFILE:
${styleProfile}

PLATFORM: ${platform}
OUTPUT LANGUAGE: ${language ?? 'English'}

SCRIPT:
${script}

SCORING (1-10 each):
1. style_match — Sounds genuinely like this creator? Same vocabulary, energy, sentence rhythm?
2. originality — Fresh and specific? (Generic motivational fluff = low score)
3. platform_fit — Right length, structure, pacing for ${platform}?
4. hook_strength — Does the opening DEMAND attention? Would you stop scrolling?

${language === 'Tinglish' ? `TINGLISH RULE: If ANY Telugu script characters appear (అ ఆ ఇ చేయి etc.), deduct 3 from style_match automatically.
` : ''}GRADING SCALE:
- 9-10: Exceptional — sounds exactly like them, scroll-stopping
- 7-8: Good — passes, minor polish possible
- 5-6: Average — generic or off-brand, needs rewrite
- 1-4: Poor — wrong voice, wrong format, or copied

ALL scores must be 7+ to pass.

Return ONLY valid JSON:
{
  "style_match": 7,
  "originality": 7,
  "platform_fit": 8,
  "hook_strength": 7,
  "overall_pass": true,
  "improvement_feedback": "Specific actionable feedback — what exactly needs to change"
}
`

export const LANGUAGE_ADAPTATION_PROMPT = (styleProfile: object, targetLanguage: string): string => `
You are an expert multilingual content strategist.

Adapt this creator's style for scripts in: ${targetLanguage}

Original Style Profile:
${JSON.stringify(styleProfile, null, 2)}

${targetLanguage === 'Tinglish' ? `TINGLISH RULES:
- Tinglish = Telugu words in Roman/English letters + English words mixed naturally
- NEVER suggest Telugu script (అ ఆ ఇ చేయి etc.) — only Roman phonetic spellings
- Convert vocabulary: "చేయి"→"cheyi"  "మనం"→"manam"  "ఇది"→"idi"  "ఎందుకు"→"enduku"
- Show rhythm with Roman-Telugu example sentences
` : ''}
Adapt vocab, CTAs, and transitions to natural ${targetLanguage} equivalents.
Keep the same tone, energy, and personality.
Keep English technical terms commonly used in ${targetLanguage} content.

Write 3-5 sentences describing how to write in this creator's style in ${targetLanguage}.
Include 2-3 example phrases in their voice.
Do NOT return JSON.
`

export const RESEARCH_PROMPT = (niche: string, platform: string, language: string): string => `
You are a content trend analyst.

What is trending RIGHT NOW for:
Niche: ${niche}
Platform: ${platform}
Language/Region: ${language}

Return ONLY valid JSON:
{
  "trending_topics": ["topic 1", "topic 2", "topic 3", "topic 4", "topic 5"],
  "viral_hook_styles": ["hook style 1", "hook style 2", "hook style 3"],
  "context_summary": "2-3 sentence summary of the current content landscape for this niche"
}
`

// MASTER_STYLE_PROMPT lives in analyzer.prompts.ts — exported here for backward compat if needed
export { MASTER_STYLE_PROMPT } from '../analyzer/analyzer.prompts'
