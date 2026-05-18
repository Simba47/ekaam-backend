import { callClaude } from '../utils/claude'
import { LANGUAGE_ADAPTATION_PROMPT } from '../modules/generator/generator.prompts'
import { logger } from '../utils/logger'

export const languageAgent = {
  async adapt(input: {
    styleProfile: object
    targetLanguage: string
    creatorLanguage: string
  }): Promise<string> {
    const { styleProfile, targetLanguage, creatorLanguage } = input

    logger.debug('LanguageAgent adapting style', { targetLanguage, creatorLanguage })

    // If same language, return profile as JSON string
    if (
      targetLanguage === creatorLanguage ||
      targetLanguage === 'auto' ||
      creatorLanguage === 'auto'
    ) {
      return JSON.stringify(styleProfile, null, 2)
    }

    try {
      // Strip Telugu Unicode from profile before sending to Claude for Tinglish
      // so Claude doesn't learn to output Telugu script from the examples
      const sanitizedProfile = (targetLanguage === 'Tinglish' || targetLanguage === 'te-en')
        ? JSON.parse(JSON.stringify(styleProfile).replace(/[ఀ-౿]+/g, ''))
        : styleProfile
      const prompt = LANGUAGE_ADAPTATION_PROMPT(sanitizedProfile, targetLanguage)
      const adaptedContext = await callClaude(prompt, undefined, 1024)
      return adaptedContext
    } catch (error) {
      logger.error('LanguageAgent failed, using original style', {
        error: (error as Error).message,
      })
      // Fall back to original profile
      return JSON.stringify(styleProfile, null, 2)
    }
  },
}
