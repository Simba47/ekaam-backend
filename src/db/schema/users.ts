import { pgTable, uuid, text, boolean, timestamp } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  instagramConnected: boolean('instagram_connected').default(false),
  instagramUsername: text('instagram_username'),
  instagramAccessToken: text('instagram_access_token'),
  instagramTokenExpiry: timestamp('instagram_token_expiry'),
  trainingStatus: text('training_status').default('none'),
  // 'none'|'pending'|'processing'|'ready'
  niche: text('niche'),
  preferredLanguage: text('preferred_language'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
