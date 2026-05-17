import { pgTable, uuid, text, integer, timestamp, jsonb } from 'drizzle-orm/pg-core'
import { users } from './users'

export const inspirationSources = pgTable('inspiration_sources', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  url: text('url').notNull(),
  type: text('type').notNull(),
  // 'youtube_channel' | 'youtube_video' | 'instagram_account' | 'instagram_reel'
  name: text('name'),
  thumbnail: text('thumbnail'),
  styleProfile: jsonb('style_profile').default({}),
  transcripts: jsonb('transcripts').default([]),
  videosScraped: integer('videos_scraped').default(0),
  status: text('status').default('pending'),
  // 'pending' | 'processing' | 'ready' | 'failed'
  errorMessage: text('error_message'),
  addedMonth: text('added_month').notNull(),
  // format: "2026-04"
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

export type InspirationSource = typeof inspirationSources.$inferSelect
export type NewInspirationSource = typeof inspirationSources.$inferInsert
