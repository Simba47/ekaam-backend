import { pgTable, uuid, text, integer, timestamp, jsonb } from 'drizzle-orm/pg-core'
import { trainingContent } from './trainingContent'

export const contentAnalysis = pgTable('content_analysis', {
  id: uuid('id').defaultRandom().primaryKey(),
  contentId: uuid('content_id')
    .references(() => trainingContent.id, { onDelete: 'cascade' })
    .notNull(),

  // ── Original fields ───────────────────────────────────────────────
  hookPattern:      text('hook_pattern'),
  hookStrength:     integer('hook_strength'),
  bodyStructure:    text('body_structure'),
  transitionPhrases: jsonb('transition_phrases').default([]),
  ctaPattern:       text('cta_pattern'),
  recurringPhrases: jsonb('recurring_phrases').default([]),
  tone:             text('tone'),
  energyLevel:      text('energy_level'),
  sentenceAvgLength: integer('sentence_avg_length'),
  language:         text('language'),

  // ── 12-attribute deep profile ─────────────────────────────────────
  // 1. Hook Type — question | shock | story | stat | challenge | relatable | bold_claim
  hookType:         text('hook_type'),

  // 2. Narrative Structure — hero_journey | problem_solution | listicle | transformation | day_in_life | rant | myth_busting
  narrativeStructure: text('narrative_structure'),

  // 3. Idea Style — contrarian | educational | experiential | inspirational | analytical | entertaining | opinion
  ideaStyle:        text('idea_style'),

  // 4. Persona — mentor | friend | expert | entertainer | challenger | storyteller | provocateur
  persona:          text('persona'),

  // 5. Rhythm Pattern — staccato | flowing | varied | repetitive | building | call_response
  rhythmPattern:    text('rhythm_pattern'),

  // 6. Emotional Arc — the emotional journey through the video
  emotionalArc:     text('emotional_arc'),

  // 7. Power Words — high-impact words that create strong reactions
  powerWords:       jsonb('power_words').default([]),

  // 8. Pacing Style — fast_cut | slow_build | constant_pressure | wave_pattern | punchy_pauses
  pacingStyle:      text('pacing_style'),

  // 9. Signature Patterns — unique repeating patterns only this creator uses
  signaturePatterns: jsonb('signature_patterns').default([]),

  analyzedAt: timestamp('analyzed_at').defaultNow(),
})

export type ContentAnalysis = typeof contentAnalysis.$inferSelect
export type NewContentAnalysis = typeof contentAnalysis.$inferInsert
