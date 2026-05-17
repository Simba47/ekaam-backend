import Anthropic from '@anthropic-ai/sdk'
import { env } from '../config/env'
import { logger } from './logger'

export const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY ?? '',
})

export const MODEL = 'claude-sonnet-4-6'
// Use sonnet-4-5 for QC and analysis tasks (upgraded from haiku)
export const MODEL_FAST = 'claude-sonnet-4-5'

export interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: string
}

const CALL_TIMEOUT_MS = 120_000 // 2 min for long scripts
const MAX_RETRIES = 3

const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Claude API call timed out after ${ms / 1000}s (${label})`)), ms)
  )
  return Promise.race([promise, timeout])
}

const is429 = (error: unknown): boolean =>
  (error as Error)?.message?.includes('429') || (error as any)?.status === 429

export const callClaude = async (
  prompt: string,
  systemPrompt?: string,
  maxTokens = 4096,
  fast = false
): Promise<string> => {
  const model = fast ? MODEL_FAST : MODEL
  let lastError: unknown

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoffMs = attempt * 20_000 // 20s, 40s, 60s
      logger.warn(`Claude 429 — retrying in ${backoffMs / 1000}s`, { attempt })
      await new Promise(r => setTimeout(r, backoffMs))
    }

    try {
      const response = await withTimeout(
        anthropic.messages.create({
          model,
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: [{ role: 'user', content: prompt }],
        }),
        CALL_TIMEOUT_MS,
        `maxTokens=${maxTokens}`
      )

      const content = response.content[0]
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from Claude')
      }

      return content.text
    } catch (error) {
      lastError = error
      if (!is429(error) || attempt === MAX_RETRIES) {
        logger.error('Claude API call failed', { error: (error as Error).message })
        throw error
      }
    }
  }

  throw lastError
}

export const callClaudeWithTools = async (
  prompt: string,
  tools: Anthropic.Tool[],
  systemPrompt?: string,
  maxTokens = 4096
): Promise<string> => {
  try {
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }]

    let response = await anthropic.messages.create({
      model: MODEL_FAST,
      max_tokens: maxTokens,
      system: systemPrompt,
      tools,
      messages,
    })

    while (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
      )

      const toolResults: Anthropic.ToolResultBlockParam[] = toolUseBlocks.map((toolUse) => ({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: `Search results for: ${JSON.stringify(toolUse.input)}. Simulated trending content analysis.`,
      }))

      messages.push({ role: 'assistant', content: response.content })
      messages.push({ role: 'user', content: toolResults })

      response = await anthropic.messages.create({
        model: MODEL_FAST,
        max_tokens: maxTokens,
        system: systemPrompt,
        tools,
        messages,
      })
    }

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text'
    )

    return textBlock?.text ?? ''
  } catch (error) {
    logger.error('Claude API tool call failed', { error: (error as Error).message })
    throw error
  }
}

export async function* callClaudeStreaming(
  prompt: string,
  systemPrompt?: string,
  maxTokens = 16384
): AsyncGenerator<string, void, unknown> {
  try {
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    })

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield event.delta.text
      }
    }
  } catch (error) {
    logger.error('Claude streaming failed', { error: (error as Error).message })
    throw error
  }
}

export const parseJsonFromClaude = <T>(text: string): T => {
  const cleaned = text
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim()

  try {
    return JSON.parse(cleaned) as T
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as T
    }
    throw new Error(`Failed to parse JSON from Claude response: ${text.slice(0, 200)}`)
  }
}
