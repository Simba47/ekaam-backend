import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai'

// gemini-1.5-flash — 1M context window, very cheap
// Used ONLY for StyleKnowledge building where large context is the advantage
export function getGeminiFlash(): GenerativeModel {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured')

  const genAI = new GoogleGenerativeAI(apiKey)
  return genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
    },
  })
}

// gemini-2.0-flash — used for script generation (streaming, creative writing)
export function getGeminiPro(): GenerativeModel {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured')

  const genAI = new GoogleGenerativeAI(apiKey)
  return genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      temperature: 0.9,
      maxOutputTokens: 8192,
    },
  })
}

export async function* callGeminiStreaming(prompt: string, systemInstruction?: string): AsyncGenerator<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured')
  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0.9, maxOutputTokens: 8192 },
    ...(systemInstruction ? { systemInstruction } : {}),
  })

  const MAX_RETRIES = 3
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await model.generateContentStream(prompt)
      for await (const chunk of result.stream) {
        const text = chunk.text()
        if (text) yield text
      }
      return
    } catch (err: unknown) {
      const msg = (err as Error).message ?? ''
      const is503 = msg.includes('503') || msg.includes('Service Unavailable') || msg.includes('high demand')
      if (is503 && attempt < MAX_RETRIES) {
        const waitMs = attempt * 15000
        console.warn(`[Gemini] 503 on attempt ${attempt} — retrying in ${waitMs / 1000}s...`)
        await new Promise(r => setTimeout(r, waitMs))
        continue
      }
      throw err
    }
  }
}

export async function callGeminiWithRetry(
  prompt: string,
  retries = 2,
  label = 'Gemini call'
): Promise<string> {
  const model = getGeminiFlash()

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const result = await model.generateContent(prompt)
      const text = result.response.text()

      if (!text || text.trim() === '') {
        throw new Error('Gemini returned empty response')
      }

      return text.replace(/```json\n?|```\n?/g, '').trim()
    } catch (error) {
      if (attempt > retries) {
        console.error(`[Gemini] ${label} failed after ${retries} retries:`, error)
        throw error
      }
      console.warn(`[Gemini] ${label} attempt ${attempt} failed — retrying in 3s...`)
      await new Promise(resolve => setTimeout(resolve, 3000))
    }
  }

  throw new Error(`[Gemini] ${label} exhausted all retries`)
}
