import { pgTable, uuid, text, integer, timestamp, jsonb, varchar } from 'drizzle-orm/pg-core'
import { trainingSources } from './trainingSources'

export const trainingContent = pgTable('training_content', {
  id: uuid('id').defaultRandom().primaryKey(),
  sourceId: uuid('source_id')
    .references(() => trainingSources.id, { onDelete: 'cascade' })
    .notNull(),
  contentId: text('content_id').notNull(),
  contentUrl: text('content_url').notNull(),
  title: text('title'),
  description: text('description'),
  tags: jsonb('tags').default([]),
  durationSeconds: integer('duration_seconds'),
  language: text('language'),
  fullTranscript: text('full_transcript'),
  hookText: text('hook_text'),
  bodyText: text('body_text'),
  outroText: text('outro_text'),
  platform: text('platform').default('youtube'),
  publishedAt: timestamp('published_at'),
  scrapedAt: timestamp('scraped_at').defaultNow(),
  // 'high' = sarvam/groq audio transcription, 'low' = youtube captions fallback
  confidence: varchar('confidence', { length: 10 }).default('high'),
  contentType: varchar('content_type', { length: 30 }),
})

export type TrainingContent = typeof trainingContent.$inferSelect
export type NewTrainingContent = typeof trainingContent.$inferInsert
