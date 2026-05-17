/**
 * One-time migration: Convert stored pure-Telugu scripts (language='Tinglish')
 * back to actual Tinglish (Telugu + English mix) using Claude.
 *
 * Run with:  npx tsx src/scripts/convertScriptsToTinglish.ts
 */

import * as dotenv from 'dotenv'
dotenv.config()

import Anthropic from '@anthropic-ai/sdk'
import { db } from '../db'
import { generatedScripts } from '../db/schema'
import { eq, inArray } from 'drizzle-orm'
import { env } from '../config/env'

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

async function convertToTinglish(pureTeluguScript: string): Promise<string> {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `You are a Tinglish (Telugu + English mix) language expert.

The script below was mistakenly converted to pure Telugu. Convert it back to natural Tinglish — the way Telugu-speaking content creators actually speak on YouTube/Instagram reels: a natural mix of Telugu and English words in the same sentences, similar to how people in Hyderabad/Andhra speak casually.

Rules:
- Keep Telugu words for emotions, actions, cultural concepts
- Use English for technical terms, numbers, brand names, and modern concepts
- The sentence structure can be Telugu-style (verb at end) but with English words sprinkled naturally
- Do NOT write full sentences in pure English or pure Telugu — it must be the mix
- Keep the same script structure (hook, body, CTA) and meaning
- Return ONLY the converted script, no explanations

Pure Telugu script to convert:
${pureTeluguScript}`,
      },
    ],
  })

  const content = message.content[0]
  if (content.type !== 'text') throw new Error('Unexpected response type')
  return content.text.trim()
}

async function convertToHinglish(pureHindiScript: string): Promise<string> {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `You are a Hinglish (Hindi + English mix) language expert.

The script below was mistakenly converted to pure Hindi. Convert it back to natural Hinglish — the way Hindi-speaking content creators actually speak on YouTube/Instagram reels: a natural mix of Hindi and English words in the same sentences.

Rules:
- Keep Hindi words for emotions, actions, cultural concepts
- Use English for technical terms, numbers, brand names, and modern concepts
- The sentence structure can follow Hindi patterns but with English words mixed naturally
- Do NOT write full sentences in pure English or pure Hindi — it must be the mix
- Keep the same script structure (hook, body, CTA) and meaning
- Return ONLY the converted script, no explanations

Pure Hindi script to convert:
${pureHindiScript}`,
      },
    ],
  })

  const content = message.content[0]
  if (content.type !== 'text') throw new Error('Unexpected response type')
  return content.text.trim()
}

async function main() {
  console.log('Fetching scripts with language Tinglish or Hinglish...')

  const scripts = await db.query.generatedScripts.findMany({
    where: inArray(generatedScripts.language, ['Tinglish', 'Hinglish']),
    columns: { id: true, language: true, scriptContent: true, topic: true },
  })

  if (scripts.length === 0) {
    console.log('No Tinglish/Hinglish scripts found.')
    return
  }

  console.log(`Found ${scripts.length} script(s) to convert.\n`)

  let converted = 0
  let failed = 0

  for (const script of scripts) {
    try {
      console.log(`[${script.id}] Topic: "${script.topic}" | Language: ${script.language}`)
      console.log(`  Original (first 100 chars): ${script.scriptContent.slice(0, 100)}...`)

      const newContent =
        script.language === 'Tinglish'
          ? await convertToTinglish(script.scriptContent)
          : await convertToHinglish(script.scriptContent)

      await db
        .update(generatedScripts)
        .set({ scriptContent: newContent })
        .where(eq(generatedScripts.id, script.id))

      console.log(`  Converted (first 100 chars): ${newContent.slice(0, 100)}...`)
      console.log(`  ✓ Updated\n`)
      converted++
    } catch (err) {
      console.error(`  ✗ Failed: ${(err as Error).message}\n`)
      failed++
    }
  }

  console.log(`Done. Converted: ${converted}, Failed: ${failed}`)
  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
