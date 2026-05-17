/**
 * One-time migration: adds all new columns for 12-attribute style analysis
 * and client self-training (userId on training_sources).
 *
 * Run with: npx tsx src/scripts/migrate.ts
 */

import * as dotenv from 'dotenv'
dotenv.config()

import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const migrations = [
  // ── training_sources: drop unique constraint on url, add userId ────────────
  `ALTER TABLE training_sources DROP CONSTRAINT IF EXISTS training_sources_url_unique`,
  `ALTER TABLE training_sources ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE`,

  // ── content_analysis: 12-attribute new columns ────────────────────────────
  `ALTER TABLE content_analysis ADD COLUMN IF NOT EXISTS hook_type TEXT`,
  `ALTER TABLE content_analysis ADD COLUMN IF NOT EXISTS narrative_structure TEXT`,
  `ALTER TABLE content_analysis ADD COLUMN IF NOT EXISTS idea_style TEXT`,
  `ALTER TABLE content_analysis ADD COLUMN IF NOT EXISTS persona TEXT`,
  `ALTER TABLE content_analysis ADD COLUMN IF NOT EXISTS rhythm_pattern TEXT`,
  `ALTER TABLE content_analysis ADD COLUMN IF NOT EXISTS emotional_arc TEXT`,
  `ALTER TABLE content_analysis ADD COLUMN IF NOT EXISTS power_words JSONB DEFAULT '[]'`,
  `ALTER TABLE content_analysis ADD COLUMN IF NOT EXISTS pacing_style TEXT`,
  `ALTER TABLE content_analysis ADD COLUMN IF NOT EXISTS signature_patterns JSONB DEFAULT '[]'`,

  // ── style_knowledge: 12-attribute master profile columns ──────────────────
  `ALTER TABLE style_knowledge ADD COLUMN IF NOT EXISTS hook_types JSONB DEFAULT '[]'`,
  `ALTER TABLE style_knowledge ADD COLUMN IF NOT EXISTS narrative_structures JSONB DEFAULT '[]'`,
  `ALTER TABLE style_knowledge ADD COLUMN IF NOT EXISTS idea_styles JSONB DEFAULT '[]'`,
  `ALTER TABLE style_knowledge ADD COLUMN IF NOT EXISTS persona TEXT`,
  `ALTER TABLE style_knowledge ADD COLUMN IF NOT EXISTS rhythm_profile TEXT`,
  `ALTER TABLE style_knowledge ADD COLUMN IF NOT EXISTS emotional_patterns TEXT`,
  `ALTER TABLE style_knowledge ADD COLUMN IF NOT EXISTS power_words JSONB DEFAULT '[]'`,
  `ALTER TABLE style_knowledge ADD COLUMN IF NOT EXISTS pacing_style TEXT`,
  `ALTER TABLE style_knowledge ADD COLUMN IF NOT EXISTS signature_patterns JSONB DEFAULT '[]'`,

  // ── user_personal_style: mirror new fields ────────────────────────────────
  `ALTER TABLE user_personal_style ADD COLUMN IF NOT EXISTS best_transitions JSONB DEFAULT '[]'`,
  `ALTER TABLE user_personal_style ADD COLUMN IF NOT EXISTS example_sentences JSONB DEFAULT '[]'`,
  `ALTER TABLE user_personal_style ADD COLUMN IF NOT EXISTS hook_types JSONB DEFAULT '[]'`,
  `ALTER TABLE user_personal_style ADD COLUMN IF NOT EXISTS narrative_structures JSONB DEFAULT '[]'`,
  `ALTER TABLE user_personal_style ADD COLUMN IF NOT EXISTS idea_styles JSONB DEFAULT '[]'`,
  `ALTER TABLE user_personal_style ADD COLUMN IF NOT EXISTS persona TEXT`,
  `ALTER TABLE user_personal_style ADD COLUMN IF NOT EXISTS rhythm_profile TEXT`,
  `ALTER TABLE user_personal_style ADD COLUMN IF NOT EXISTS emotional_patterns TEXT`,
  `ALTER TABLE user_personal_style ADD COLUMN IF NOT EXISTS power_words JSONB DEFAULT '[]'`,
  `ALTER TABLE user_personal_style ADD COLUMN IF NOT EXISTS pacing_style TEXT`,
  `ALTER TABLE user_personal_style ADD COLUMN IF NOT EXISTS signature_patterns JSONB DEFAULT '[]'`,

  // ── Indexes for scale ──────────────────────────────────────────────────────
  `CREATE INDEX IF NOT EXISTS idx_training_sources_user_id ON training_sources(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_training_sources_status ON training_sources(status)`,
  `CREATE INDEX IF NOT EXISTS idx_training_content_source_id ON training_content(source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_content_analysis_content_id ON content_analysis(content_id)`,
  `CREATE INDEX IF NOT EXISTS idx_generated_scripts_user_id ON generated_scripts(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_generated_scripts_created_at ON generated_scripts(created_at DESC)`,

  // ── Migration batch 2: Sarvam confidence + brand video + niche fields ─────

  // training_content: transcript quality confidence + content type
  `ALTER TABLE training_content ADD COLUMN IF NOT EXISTS confidence VARCHAR(10) DEFAULT 'high'`,
  `ALTER TABLE training_content ADD COLUMN IF NOT EXISTS content_type VARCHAR(30)`,

  // style_knowledge: quality confidence from new-format master profile
  `ALTER TABLE style_knowledge ADD COLUMN IF NOT EXISTS quality_confidence JSONB`,

  // generated_scripts: brand video mode fields
  `ALTER TABLE generated_scripts ADD COLUMN IF NOT EXISTS is_promo_video TEXT DEFAULT 'false'`,
  `ALTER TABLE generated_scripts ADD COLUMN IF NOT EXISTS brand_name TEXT`,
  `ALTER TABLE generated_scripts ADD COLUMN IF NOT EXISTS native_integration_score INTEGER`,

  // users: niche + preferred language for trends API
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS niche TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_language TEXT`,
]

async function run() {
  const client = await pool.connect()
  try {
    console.log('Running migrations...\n')
    for (const sql of migrations) {
      try {
        await client.query(sql)
        console.log(`✓ ${sql.slice(0, 80)}...`)
      } catch (err) {
        console.error(`✗ ${sql.slice(0, 80)}`)
        console.error(`  Error: ${(err as Error).message}\n`)
      }
    }
    console.log('\nMigration complete.')
  } finally {
    client.release()
    await pool.end()
  }
}

run().catch(err => { console.error(err); process.exit(1) })
