import { pgTable, uuid, text, integer, timestamp, jsonb } from 'drizzle-orm/pg-core'
import { trainingSources } from './trainingSources'
import { users } from './users'

export const generatedScripts = pgTable('generated_scripts', {
  id: uuid('id').defaultRandom().primaryKey(),
  sourceId: uuid('source_id')
    .references(() => trainingSources.id),
  userId: uuid('user_id')
    .references(() => users.id),
  // one of sourceId or userId will be set
  platform: text('platform').notNull(),
  // 'youtube'|'instagram_reel'|'podcast'|'ad'
  niche: text('niche'),
  language: text('language').notNull(),
  topic: text('topic').notNull(),
  durationSeconds: integer('duration_seconds'),
  scriptContent: text('script_content').notNull(),
  styleMatchScore: integer('style_match_score'),
  originalityScore: integer('originality_score'),
  platformFitScore: integer('platform_fit_score'),
  hookStrengthScore: integer('hook_strength_score'),
  tone: text('tone').default('motivational'),
  format: text('format'),
  targetAudience: text('target_audience'),
  keyMessage: text('key_message'),
  keyPoints: text('key_points'),
  additionalInstructions: text('additional_instructions'),
  sourcesUsed: jsonb('sources_used').default([]),
  createdAt: timestamp('created_at').defaultNow(),
  // Brand video mode fields
  isPromoVideo: text('is_promo_video').default('false'),
  brandName: text('brand_name'),
  nativeIntegrationScore: integer('native_integration_score'),
})

export type GeneratedScript = typeof generatedScripts.$inferSelect
export type NewGeneratedScript = typeof generatedScripts.$inferInsert
