import { pgTable, uuid, text, integer, timestamp } from 'drizzle-orm/pg-core'
import { users } from './users'

export const trainingSources = pgTable('training_sources', {
  id: uuid('id').defaultRandom().primaryKey(),
  type: text('type').notNull(),
  // 'youtube_channel' | 'youtube_video' | 'instagram_account'
  url: text('url').notNull(),
  // NOTE: url is no longer globally unique — two users can add the same channel independently
  channelId: text('channel_id'),
  name: text('name'),
  niche: text('niche'),
  // 'fitness'|'finance'|'tech'|'lifestyle'|'motivation'|'cooking'|'travel'|'other'
  language: text('language').default('auto'),
  // 'en'|'hi'|'te'|'ta'|'kn'|'ml'|'auto'
  status: text('status').default('pending'),
  // 'pending'|'processing'|'ready'|'failed'
  totalVideos:     integer('total_videos').default(0),
  processedVideos: integer('processed_videos').default(0),
  errorMessage:    text('error_message'),
  addedBy:         text('added_by').default('admin'),
  // null = admin global source; uuid = user's own training source
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

export type TrainingSource = typeof trainingSources.$inferSelect
export type NewTrainingSource = typeof trainingSources.$inferInsert
