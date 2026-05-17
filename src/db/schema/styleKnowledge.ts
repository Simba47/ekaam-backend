import { pgTable, uuid, text, integer, varchar, timestamp, jsonb } from 'drizzle-orm/pg-core'
import { trainingSources } from './trainingSources'

export const styleKnowledge = pgTable('style_knowledge', {
  id: uuid('id').defaultRandom().primaryKey(),
  sourceId: uuid('source_id')
    .references(() => trainingSources.id, { onDelete: 'cascade' })
    .notNull(),

  // ── Core fields ───────────────────────────────────────────────────
  niche:              text('niche'),
  platform:           text('platform'),
  language:           text('language'),

  // ── Aggregated style arrays ───────────────────────────────────────
  bestHooks:          jsonb('best_hooks').default([]),
  bestStructures:     jsonb('best_structures').default([]),
  bestCtaPatterns:    jsonb('best_cta_patterns').default([]),
  bestTransitions:    jsonb('best_transitions').default([]),
  vocabularyBank:     jsonb('vocabulary_bank').default([]),
  exampleSentences:   jsonb('example_sentences').default([]),

  // ── 12-attribute master profile ───────────────────────────────────
  // Hook types this creator uses most (ordered by frequency)
  hookTypes:          jsonb('hook_types').default([]),

  // Narrative structures they rely on
  narrativeStructures: jsonb('narrative_structures').default([]),

  // How they present ideas
  ideaStyles:         jsonb('idea_styles').default([]),

  // Their on-screen persona/character
  persona:            text('persona'),

  // Rhythm pattern description
  rhythmProfile:      text('rhythm_profile'),

  // How they use emotion across videos
  emotionalPatterns:  text('emotional_patterns'),

  // High-impact power words they use
  powerWords:         jsonb('power_words').default([]),

  // How they pace content
  pacingStyle:        text('pacing_style'),

  // Unique signature patterns that fingerprint this creator
  signaturePatterns:  jsonb('signature_patterns').default([]),

  // ── Summary fields ────────────────────────────────────────────────
  tone:               text('tone'),
  energyLevel:        text('energy_level'),
  fullAnalysis:       text('full_analysis'),
  lastUpdated:        timestamp('last_updated').defaultNow(),
  // Quality confidence metadata from new-format master profile
  qualityConfidence:  jsonb('quality_confidence'),

  // ── Build metadata ────────────────────────────────────────────────
  evolutionNotes:        text('evolution_notes'),
  totalVideosAnalysed:   integer('total_videos_analysed'),
  builtWithModel:        varchar('built_with_model', { length: 50 }).default('gemini-1.5-flash'),
})

export type StyleKnowledge = typeof styleKnowledge.$inferSelect
export type NewStyleKnowledge = typeof styleKnowledge.$inferInsert
