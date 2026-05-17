import { pgTable, uuid, text, timestamp, jsonb } from 'drizzle-orm/pg-core'
import { users } from './users'

export const userPersonalStyle = pgTable('user_personal_style', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),

  // ── Aggregated style arrays ───────────────────────────────────────
  bestHooks:          jsonb('best_hooks').default([]),
  bestStructures:     jsonb('best_structures').default([]),
  bestCtaPatterns:    jsonb('best_cta_patterns').default([]),
  vocabularyBank:     jsonb('vocabulary_bank').default([]),
  exampleSentences:   jsonb('example_sentences').default([]),
  bestTransitions:    jsonb('best_transitions').default([]),

  // ── 12-attribute deep profile ─────────────────────────────────────
  hookTypes:          jsonb('hook_types').default([]),
  narrativeStructures: jsonb('narrative_structures').default([]),
  ideaStyles:         jsonb('idea_styles').default([]),
  persona:            text('persona'),
  rhythmProfile:      text('rhythm_profile'),
  emotionalPatterns:  text('emotional_patterns'),
  powerWords:         jsonb('power_words').default([]),
  pacingStyle:        text('pacing_style'),
  signaturePatterns:  jsonb('signature_patterns').default([]),

  // ── Summary fields ────────────────────────────────────────────────
  tone:               text('tone'),
  energyLevel:        text('energy_level'),
  languageMix:        text('language_mix'),
  signatureStyle:     text('signature_style'),
  fullAnalysis:       text('full_analysis'),
  lastUpdated:        timestamp('last_updated').defaultNow(),
})

export type UserPersonalStyle = typeof userPersonalStyle.$inferSelect
export type NewUserPersonalStyle = typeof userPersonalStyle.$inferInsert
