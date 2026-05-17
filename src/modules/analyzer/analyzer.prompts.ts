// ─────────────────────────────────────────────────────────────────────────────
// CHANGE 2: Voice-level per-video style extraction prompt
// ─────────────────────────────────────────────────────────────────────────────

export const STYLE_ANALYSIS_PROMPT = (
  transcript: string,
  title: string,
  platform: string,
  confidence = 'high'
): string => `
You are an expert voice analyst specialising in Indian content creators.
Your job is to extract SPECIFIC, REPRODUCIBLE voice patterns from a video
transcript — patterns precise enough that another writer could reproduce
this creator's exact voice without ever watching their videos.

You must distinguish between:
- CORE patterns: appear consistently, define the voice
- OCCASIONAL patterns: appear sometimes, add authenticity
- ONE-OFF: ignore entirely — do not include

Video Title: ${title}
Platform: ${platform}

Output ONLY valid JSON. No explanation outside the JSON.

{
  "hook_patterns": [
    {
      "pattern": "<describe the exact structural pattern>",
      "verbatim_example": "<copied exactly from transcript>",
      "frequency": "core | occasional",
      "position": "first sentence | first 3 sentences | first paragraph"
    }
  ],
  "sentence_rhythm": {
    "avg_sentence_length_words": <number>,
    "uses_incomplete_sentences": <boolean>,
    "incomplete_sentence_examples": ["<verbatim>", "<verbatim>"],
    "natural_pause_markers": ["...", "—", "right?"],
    "rhythm_pattern": "<e.g. 2-3 short punchy sentences then 1 long explanation>"
  },
  "signature_phrases": [
    {
      "phrase": "<verbatim>",
      "context": "<when and why they use this>"
    }
  ],
  "filler_phrases": ["<real fillers creator uses — not ASR artifacts>"],
  "vocabulary": {
    "signature_words": ["<word>"],
    "avoided_register": "formal | academic | corporate | none",
    "english_insertion_rate": <0.0 to 1.0>,
    "english_insertion_context": "<when they switch to English>"
  },
  "audience_relationship": {
    "address_terms": ["<yaar>", "<bhai>", "<tum log>"],
    "relationship_type": "peer | mentor | friend | expert",
    "uses_shared_struggle": <boolean>,
    "self_deprecation": "high | medium | low | none"
  },
  "reasoning_style": "<the exact logical arc — e.g. personal failure → insight → generalisation → action>",
  "energy_arc": "<energy progression — e.g. calm open → gradual build → peak at 70% → reflective close>",
  "cta_patterns": [
    {
      "phrase": "<verbatim>",
      "placement": "end | mid | both"
    }
  ],
  "content_type": "personal_story | tutorial | motivational | reaction | educational | vlog",
  "language_mix": "<e.g. 60% Telugu 40% English — Tinglish>",
  "what_makes_this_creator_unique": "<2-3 sentences of your own synthesis>",
  "hook_pattern": "<first hook pattern description for backward compat>",
  "hook_example": "<verbatim first 2-3 sentences>",
  "hook_strength": <1-10>,
  "body_structure": "<step by step structure>",
  "transition_phrases": ["<phrase 1>", "<phrase 2>", "<phrase 3>"],
  "cta_pattern": "<closing CTA description>",
  "recurring_phrases": ["<phrase 1>", "<phrase 2>"],
  "tone": "casual | motivational | educational | inspirational | direct | storytelling",
  "energy_level": "high | medium | low",
  "sentence_avg_length": <number>,
  "hook_type": "question | shock | story | stat | challenge | relatable | bold_claim",
  "narrative_structure": "hero_journey | problem_solution | listicle | transformation | rant | myth_busting",
  "idea_style": "contrarian | educational | experiential | inspirational | analytical | entertaining | opinion",
  "persona": "mentor | friend | expert | entertainer | challenger | storyteller | provocateur",
  "rhythm_pattern": "staccato | flowing | varied | repetitive | building | call_response",
  "emotional_arc": "<emotional journey description>",
  "power_words": ["<word>"],
  "pacing_style": "fast_cut | slow_build | constant_pressure | wave_pattern | punchy_pauses",
  "signature_patterns": ["<unique pattern 1>", "<unique pattern 2>"],
  "example_sentences": ["<verbatim 1>", "<verbatim 2>", "<verbatim 3>"]
}

STRICT RULES:
1. Every verbatim_example must be copied exactly from the transcript — no paraphrasing
2. Never invent patterns not present in this transcript
3. If a field has no evidence, output null — never guess
4. "what_makes_this_creator_unique" requires genuine reasoning — think deeply
5. Distinguish real filler words (yaar, bhai, basically) from ASR artifacts (um, uh repeated)
6. If transcript confidence is "low" (YouTube captions), be more conservative — mark uncertain patterns as occasional

Transcript confidence: ${confidence}
Transcript:
${transcript}
`

// ─────────────────────────────────────────────────────────────────────────────
// CHANGE 3: Recency-weighted master Style DNA profile builder
// ─────────────────────────────────────────────────────────────────────────────

export const MASTER_STYLE_PROMPT = (
  analyses: string[],
  sourceName: string,
  totalVideos: number
): string => {
  // Sample intelligently — first 25 for early patterns, mid for variety, last 10 for recent
  let sampled: string[]
  if (analyses.length <= 40) {
    sampled = analyses
  } else {
    const first = analyses.slice(0, 25)
    const mid = analyses.slice(Math.floor(analyses.length / 2) - 5, Math.floor(analyses.length / 2) + 5)
    const last = analyses.slice(-10)
    sampled = [...first, ...mid, ...last]
  }

  return `
You are building a master Style DNA profile for ${sourceName}.
You have been given ${totalVideos} per-video style analyses ordered by recency
(most recent first, weight applied based on age).

Videos from last 6 months have weight 1.0 (most important).
Videos 6-18 months old have weight 0.7.
Videos 18+ months old have weight 0.4.

Your job is to synthesise these into ONE authoritative voice profile.
Every pattern you include must be actionable — a writer must be able to
follow it and produce output that sounds like this creator.

Frequency thresholds:
- CORE: pattern appears in >40% of videos — MUST appear in every script
- SIGNATURE: appears in 20-40% — should appear in most scripts
- OCCASIONAL: appears in <20% — use sparingly for authenticity flavour

Output ONLY valid JSON, no explanation, no markdown:

{
  "creator_voice_summary": "<3-4 sentences so precise that a writer who has never seen this creator's content could reproduce their voice exactly>",

  "core_patterns": {
    "hooks": [
      {
        "pattern": "<exact structure>",
        "frequency_pct": <number>,
        "best_example": "<verbatim from analysis>",
        "when_to_use": "<topic type or content type where this hook fits best>"
      }
    ],
    "sentence_rhythm": {
      "avg_length_words": <number>,
      "rhythm_rule": "<e.g. 2-3 short sentences then 1 long explanation, repeat>",
      "incomplete_sentence_examples": ["<verbatim>"]
    },
    "signature_phrases": ["<verbatim phrase>"],
    "cta_style": "<exact CTA pattern with verbatim example>"
  },

  "signature_patterns": {
    "hooks": [],
    "phrases": [],
    "structural_moves": ["<e.g. self-deprecation before the lesson>"]
  },

  "occasional_patterns": {
    "phrases": [],
    "moves": []
  },

  "vocabulary": {
    "must_use_words": ["<word>"],
    "must_avoid_words": ["<formal or corporate words this creator never uses>"],
    "english_insertion_rate": <0.0-1.0>,
    "english_insertion_rule": "<specific rule for when to switch to English>"
  },

  "audience_relationship": {
    "address_terms": ["<yaar>", "<bhai>"],
    "relationship_type": "peer | mentor | friend | expert",
    "tone_rule": "<e.g. never lecture — always invite them to think alongside you>"
  },

  "reasoning_arc": "<the exact logical journey this creator always takes>",

  "energy_arc": "<energy progression through a typical video>",

  "content_type_variations": [
    {
      "content_type": "tutorial | personal_story | motivational | educational",
      "hook_preference": "<which hook pattern fits this type>",
      "tone_shift": "<how their tone changes for this content type>"
    }
  ],

  "contradictions": [
    "<e.g. uses formal vocabulary in finance tutorials but casual in personal vlogs>"
  ],

  "quality_confidence": {
    "total_videos_analysed": ${totalVideos},
    "high_confidence_fields": ["<fields with strong evidence across many videos>"],
    "low_confidence_fields": ["<fields based on fewer than 5 examples>"],
    "overall_confidence": "high | medium | low"
  },

  "best_hooks": [
    {
      "pattern": "<describe the hook structure>",
      "example": "<write this IN the creator's exact voice>",
      "strength": 9,
      "when_to_use": "<type of content this suits>"
    }
  ],
  "best_structures": [
    {
      "format": "<structure name>",
      "description": "<step-by-step how they build content>",
      "best_for": "<content type>"
    }
  ],
  "best_transitions": ["<exact transition phrase 1>", "<exact transition phrase 2>"],
  "best_cta_patterns": ["<exact CTA phrase 1 in their voice>", "<exact CTA phrase 2>"],
  "vocabulary_bank": ["<their word 1>", "<their word 2>"],
  "example_sentences": [
    "<real sentence from their content 1>",
    "<real sentence 2>",
    "<real sentence 3>"
  ],
  "tone": "<detailed description — emotional register, relationship with audience, personality>",
  "energy_level": "high | medium | low",
  "signature_style": "<4-5 sentences: what makes this creator unmistakably them>",
  "language_patterns": "<languages used, ratio, script vs Roman, how/when they code-switch>",
  "niche": "<niche in 1-3 words>"
}

STRICT RULES:
- Only include CORE patterns that appear in 40%+ of videos
- Every example must be in the creator's actual voice using their real words
- vocabulary_bank = their unique words only, reject generic: success, mindset, hustle, grind
- example_sentences must be real sentences from their content
- If a pattern only appears once, do NOT include it

Analyses (showing ${sampled.length} of ${totalVideos}, most recent first):
${sampled.map((a, i) => `=== Video ${i + 1} ===\n${a}`).join('\n\n')}
`
}
