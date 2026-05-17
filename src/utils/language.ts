// Language detection based on character ranges and common words
// This is a lightweight approach without external dependencies

const LANGUAGE_PATTERNS: Record<string, RegExp> = {
  te: /[\u0C00-\u0C7F]/,         // Telugu
  hi: /[\u0900-\u097F]/,         // Hindi/Devanagari
  ta: /[\u0B80-\u0BFF]/,         // Tamil
  kn: /[\u0C80-\u0CFF]/,         // Kannada
  ml: /[\u0D00-\u0D7F]/,         // Malayalam
  ar: /[\u0600-\u06FF]/,         // Arabic
  zh: /[\u4E00-\u9FFF]/,         // Chinese
  ja: /[\u3040-\u30FF]/,         // Japanese
  ko: /[\uAC00-\uD7AF]/,         // Korean
}

const ENGLISH_WORDS = new Set([
  'the', 'is', 'are', 'was', 'were', 'this', 'that', 'and', 'or', 'but',
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'you', 'we', 'they',
  'have', 'has', 'had', 'will', 'would', 'can', 'could', 'should',
])

export const detectLanguage = (text: string): string => {
  if (!text || text.trim().length === 0) return 'en'

  // Check for non-Latin scripts first
  for (const [lang, pattern] of Object.entries(LANGUAGE_PATTERNS)) {
    const matches = (text.match(new RegExp(pattern.source, 'g')) || []).length
    const ratio = matches / text.length
    if (ratio > 0.1) return lang
  }

  // Default to English for Latin scripts
  const words = text.toLowerCase().split(/\s+/)
  const englishCount = words.filter((w) => ENGLISH_WORDS.has(w)).length
  const englishRatio = englishCount / words.length

  if (englishRatio > 0.05) return 'en'

  return 'en' // Default fallback
}

export const SUPPORTED_LANGUAGES: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  te: 'Telugu',
  ta: 'Tamil',
  kn: 'Kannada',
  ml: 'Malayalam',
  tinglish: 'Tinglish (Telugu + English)',
  auto: 'Auto-detect',
}

export const getLanguageName = (code: string): string => {
  return SUPPORTED_LANGUAGES[code] ?? code
}

export const isSupportedLanguage = (code: string): boolean => {
  return code in SUPPORTED_LANGUAGES
}
