import { pgTable, uuid, text, timestamp, jsonb } from 'drizzle-orm/pg-core'
import { users } from './users'

export const userContent = pgTable('user_content', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  contentType: text('content_type').notNull(),
  // 'reel'|'post'|'story'
  contentId: text('content_id').notNull(),
  caption: text('caption'),
  transcript: text('transcript'),
  hashtags: jsonb('hashtags').default([]),
  platform: text('platform').default('instagram'),
  publishedAt: timestamp('published_at'),
  scrapedAt: timestamp('scraped_at').defaultNow(),
})

export type UserContent = typeof userContent.$inferSelect
export type NewUserContent = typeof userContent.$inferInsert
