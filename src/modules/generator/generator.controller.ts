import { Request, Response } from 'express'
import { generatorService } from './generator.service'
import { logger } from '../../utils/logger'

interface GenerateBody {
  sourceId?: string
  userId?: string
  inspirationId?: string
  platform?: string
  format?: string
  language: string
  topic: string
  targetAudience?: string
  keyMessage?: string
  keyPoints?: string
  additionalInstructions?: string
  durationSeconds?: number
  tones?: string[]
  tone?: string
  niche?: string
}

const formatToPlatform = (format?: string, platform?: string): string => {
  if (platform) return platform
  const map: Record<string, string> = { reel_15: 'instagram_reel', reel_60: 'instagram_reel', shorts: 'youtube', youtube_long: 'youtube', linkedin: 'youtube', tiktok: 'instagram_reel', podcast: 'podcast', ad: 'ad' }
  return format ? (map[format] ?? 'youtube') : 'youtube'
}

const formatToDuration = (format?: string, provided?: number): number => {
  if (provided && provided > 15) return provided
  const map: Record<string, number> = { reel_15: 20, reel_60: 45, shorts: 60, youtube_long: 480, linkedin: 90, tiktok: 30, podcast: 600, ad: 30 }
  return format ? (map[format] ?? 300) : (provided ?? 300)
}

export const generatorController = {
  async generateScript(req: Request, res: Response): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()

    let closed = false
    res.on('close', () => { closed = true })

    const keepAlive = setInterval(() => {
      if (!closed && !res.writableEnded) res.write(': ping\n\n')
    }, 15000)

    try {
      const body = req.body as GenerateBody
      res.write(': connected\n\n')

      const tones = body.tones?.length ? body.tones : [body.tone ?? 'motivational']
      const platform = formatToPlatform(body.format, body.platform)
      const durationSeconds = formatToDuration(body.format, body.durationSeconds)

      await generatorService.generate({
        sourceId: body.sourceId,
        userId: body.userId,
        inspirationId: body.inspirationId,
        platform, format: body.format, language: body.language,
        topic: body.topic, targetAudience: body.targetAudience,
        keyMessage: body.keyMessage, keyPoints: body.keyPoints,
        additionalInstructions: body.additionalInstructions,
        durationSeconds, tones, niche: body.niche, saveScript: true,
        onChunk: (chunk: string) => {
          if (!closed && !res.writableEnded) {
            if (chunk.includes('--- Improving script')) {
              res.write(`data: ${JSON.stringify({ type: 'reset' })}\n\n`)
            } else {
              res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`)
            }
          }
        },
        onQcResult: (scores: object) => {
          if (!closed) res.write(`data: ${JSON.stringify({ type: 'qc', scores })}\n\n`)
        },
        onPolished: (polishedScript: string) => {
          if (!closed) res.write(`data: ${JSON.stringify({ type: 'polished', text: polishedScript })}\n\n`)
        },
      }).then((result) => {
        if (!closed) res.write(`data: ${JSON.stringify({ type: 'done', scriptId: result.id, scores: result.scores })}\n\n`)
      }).catch((error) => {
        logger.error('Script generation failed', { error: (error as Error).message })
        if (!closed && !res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: 'error', message: (error as Error).message })}\n\n`)
        }
      }).finally(() => {
        clearInterval(keepAlive)
        if (!res.writableEnded) res.end()
      })
    } catch (error) {
      clearInterval(keepAlive)
      logger.error('generateScript setup failed', { error: (error as Error).message })
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: (error as Error).message })}\n\n`)
        res.end()
      }
    }
  },
}
