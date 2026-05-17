import { callClaude, parseJsonFromClaude } from '../utils/claude'
import { RESEARCH_PROMPT } from '../modules/generator/generator.prompts'
import { logger } from '../utils/logger'

interface ResearchResult {
  trendingTopics: string[]
  viralHooks: string[]
  context: string
}

interface ResearchResponse {
  trending_topics: string[]
  viral_hook_styles: string[]
  context_summary: string
}

export const researchAgent = {
  async run(input: {
    niche: string
    platform: string
    language: string
  }): Promise<ResearchResult> {
    const { niche, platform, language } = input

    logger.info('ResearchAgent running', { niche, platform, language })

    try {
      const prompt = RESEARCH_PROMPT(niche, platform, language)
      const response = await callClaude(prompt, undefined, 1024)
      const parsed = parseJsonFromClaude<ResearchResponse>(response)

      const trendingTopics = parsed.trending_topics ?? []
      const viralHooks = parsed.viral_hook_styles ?? []
      const context = [
        parsed.context_summary ?? '',
        trendingTopics.length > 0 ? `Trending topics: ${trendingTopics.join(', ')}` : '',
        viralHooks.length > 0 ? `Viral hook styles: ${viralHooks.join(', ')}` : '',
      ].filter(Boolean).join('\n')

      return { trendingTopics, viralHooks, context }
    } catch (error) {
      logger.error('ResearchAgent failed', { error: (error as Error).message })
      return {
        trendingTopics: [],
        viralHooks: [],
        context: `Content in ${niche} niche on ${platform} for ${language} audience.`,
      }
    }
  },
}
