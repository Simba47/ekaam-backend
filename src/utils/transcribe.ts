import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { spawnSync } from 'child_process'
import FormData from 'form-data'
import ytDlpExec from 'yt-dlp-exec'
import Groq from 'groq-sdk'
import axios from 'axios'
import { env } from '../config/env'
import { logger } from './logger'

const CHUNK_DURATION_SECONDS = 25  // Sarvam starter plan limit is 30s — 25s + 5s overlap = 30s max
const OVERLAP_SECONDS = 5
const CHUNK_DELAY_MS = 2000

export interface TranscribeResult {
  transcript: string | null
  confidence: 'high' | 'low'
}

const getAudioDurationSec = (audioPath: string): number => {
  try {
    const result = spawnSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', audioPath,
    ], { encoding: 'utf8' })
    return parseFloat(result.stdout?.trim() ?? '0') || 0
  } catch { return 0 }
}

// Pre-process audio for better Sarvam transcription quality
const preprocessAudio = (inputPath: string): string => {
  const outputPath = inputPath.replace(/\.(mp3|wav|m4a|webm)$/, '_processed.mp3')
  const result = spawnSync('ffmpeg', [
    '-y', '-i', inputPath,
    '-af', 'highpass=f=200,lowpass=f=3000,volume=1.5,dynaudnorm',
    '-ar', '16000',
    '-ac', '1',
    '-loglevel', 'error',
    outputPath,
  ])
  if (result.status === 0 && fs.existsSync(outputPath)) return outputPath
  logger.warn('Audio preprocessing failed — using original', { status: result.status })
  return inputPath
}

// Extract a single chunk from start to end seconds
const extractAudioChunk = (audioPath: string, startSec: number, endSec: number, chunkIndex: number): string => {
  const tmpDir = path.dirname(audioPath)
  const base = path.basename(audioPath, path.extname(audioPath))
  const chunkPath = path.join(tmpDir, `${base}_chunk${chunkIndex}.mp3`)

  spawnSync('ffmpeg', [
    '-y', '-i', audioPath,
    '-ss', String(startSec),
    '-to', String(endSec),
    '-acodec', 'copy',
    '-loglevel', 'error',
    chunkPath,
  ])

  return fs.existsSync(chunkPath) ? chunkPath : ''
}

// Merge sequential chunks, removing duplicate overlap text at boundaries
const mergeChunksWithDeduplication = (chunks: string[]): string => {
  if (chunks.length === 0) return ''
  if (chunks.length === 1) return chunks[0]

  let merged = chunks[0]
  for (let i = 1; i < chunks.length; i++) {
    const prevWords = merged.split(' ').slice(-20).join(' ')
    const currentChunk = chunks[i]

    // Find where current chunk overlaps with end of merged text
    const overlapAnchor = prevWords.split(' ')[5]
    if (!overlapAnchor) {
      merged += ' ' + currentChunk
      continue
    }

    const overlapIndex = currentChunk.indexOf(overlapAnchor)
    if (overlapIndex > 0) {
      merged += ' ' + currentChunk.slice(overlapIndex + overlapAnchor.length).trim()
    } else {
      merged += ' ' + currentChunk
    }
  }
  return merged.trim()
}

const groq = new Groq({ apiKey: env.GROQ_API_KEY ?? '' })

const detectLangCode = (hint?: string): string | null => {
  if (!hint || hint === 'auto') return null
  const h = hint.toLowerCase()
  if (h === 'te-in' || h === 'te' || h === 'telugu' || h === 'tinglish') return 'te-IN'
  if (h === 'hi-in' || h === 'hi' || h === 'hindi' || h === 'hinglish') return 'hi-IN'
  if (h === 'ta-in' || h === 'ta' || h === 'tamil') return 'ta-IN'
  if (h === 'kn-in' || h === 'kn' || h === 'kannada') return 'kn-IN'
  if (h === 'ml-in' || h === 'ml' || h === 'malayalam') return 'ml-IN'
  if (h === 'en' || h === 'english') return 'en-IN'
  return null
}

// Transcribe using Sarvam AI — sequential 60s chunks with 5s overlap
const transcribeWithSarvam = async (
  audioPath: string,
  languageCode?: string | null
): Promise<string | null> => {
  if (!env.SARVAM_API_KEY) {
    logger.warn('SARVAM_API_KEY not set — skipping Sarvam transcription')
    return null
  }

  // Pre-process for better quality
  const processedPath = preprocessAudio(audioPath)
  const isPreprocessed = processedPath !== audioPath

  const duration = getAudioDurationSec(processedPath)
  if (duration <= 0) {
    if (isPreprocessed && fs.existsSync(processedPath)) {
      try { fs.unlinkSync(processedPath) } catch { /* ignore */ }
    }
    return null
  }

  const chunkTranscripts: string[] = []
  const chunkPaths: string[] = []
  let startTime = 0
  let chunkIndex = 0

  try {
    while (startTime < duration) {
      const endTime = Math.min(startTime + CHUNK_DURATION_SECONDS, duration)
      // Extend end by overlap seconds (except for the last chunk)
      const chunkEndWithOverlap = endTime < duration
        ? Math.min(endTime + OVERLAP_SECONDS, duration)
        : endTime

      const chunkPath = extractAudioChunk(processedPath, startTime, chunkEndWithOverlap, chunkIndex)

      if (chunkPath) {
        chunkPaths.push(chunkPath)

        if (chunkIndex > 0) await new Promise(r => setTimeout(r, CHUNK_DELAY_MS))

        try {
          const form = new FormData()
          form.append('file', fs.createReadStream(chunkPath), {
            filename: 'audio.mp3',
            contentType: 'audio/mpeg',
          })
          if (languageCode) form.append('language_code', languageCode)
          form.append('model', 'saaras:v3')
          form.append('with_timestamps', 'false')

          const response = await axios.post(
            'https://api.sarvam.ai/speech-to-text',
            form,
            {
              headers: { ...form.getHeaders(), 'api-subscription-key': env.SARVAM_API_KEY },
              timeout: 120000,
            }
          )
          const text: string = response.data?.transcript || response.data?.text || ''
          if (text.trim()) chunkTranscripts.push(text.trim())
        } catch (chunkErr: unknown) {
          const err = chunkErr as { message?: string; response?: { status?: number; data?: unknown } }
          logger.warn(`Sarvam chunk ${chunkIndex + 1} failed`, {
            error: err.message,
            status: err.response?.status,
          })
        }
      }

      startTime += CHUNK_DURATION_SECONDS
      chunkIndex++
    }

    if (chunkTranscripts.length === 0) return null

    const transcript = mergeChunksWithDeduplication(chunkTranscripts)
    logger.info('Sarvam transcription complete', {
      chars: transcript.length,
      chunks: chunkIndex,
      language: languageCode,
    })
    return transcript
  } finally {
    for (const p of chunkPaths) {
      if (fs.existsSync(p)) try { fs.unlinkSync(p) } catch { /* ignore */ }
    }
    if (isPreprocessed && fs.existsSync(processedPath)) {
      try { fs.unlinkSync(processedPath) } catch { /* ignore */ }
    }
  }
}

const SARVAM_TO_ISO: Record<string, string> = {
  'te-IN': 'te', 'hi-IN': 'hi', 'ta-IN': 'ta',
  'kn-IN': 'kn', 'ml-IN': 'ml', 'en-IN': 'en',
}

const transcribeWithGroq = async (audioPath: string, langCode?: string): Promise<string | null> => {
  if (!env.GROQ_API_KEY) return null

  try {
    const fileSizeBytes = fs.statSync(audioPath).size
    if (fileSizeBytes > 24 * 1024 * 1024) {
      logger.warn('Audio file too large for Groq Whisper')
      return null
    }

    const isoLang = langCode ? SARVAM_TO_ISO[langCode] : undefined

    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: 'whisper-large-v3-turbo',
      response_format: 'text',
      ...(isoLang ? { language: isoLang } : {}),
    })

    const text = typeof transcription === 'string'
      ? transcription
      : (transcription as { text: string }).text

    logger.info('Groq transcription complete', { chars: text?.length })
    return text?.trim() || null
  } catch (error) {
    logger.warn('Groq transcription failed', { error: (error as Error).message })
    return null
  }
}

const SARVAM_LANG_MAP: Record<string, string> = {
  telugu: 'te-IN', te: 'te-IN', 'te-in': 'te-IN',
  hindi: 'hi-IN', hi: 'hi-IN', 'hi-in': 'hi-IN',
  tamil: 'ta-IN', ta: 'ta-IN', 'ta-in': 'ta-IN',
  kannada: 'kn-IN', kn: 'kn-IN', 'kn-in': 'kn-IN',
  malayalam: 'ml-IN', ml: 'ml-IN', 'ml-in': 'ml-IN',
}

export const getSarvamLangCode = (language: string): string | null => {
  return SARVAM_LANG_MAP[language.toLowerCase()] ?? null
}

// Polish a generated script using Sarvam translate.
// NOTE: Tinglish and Hinglish are excluded — Sarvam translate would destroy the mixed-language style.
export const polishWithSarvam = async (
  script: string,
  targetLanguage: string
): Promise<string | null> => {
  if (!env.SARVAM_API_KEY) return null

  const targetCode = getSarvamLangCode(targetLanguage)
  if (!targetCode) return null

  try {
    logger.info('Polishing script with Sarvam', { targetLanguage, targetCode, chars: script.length })

    const CHUNK_SIZE = 900
    const chunks: string[] = []
    for (let i = 0; i < script.length; i += CHUNK_SIZE) {
      chunks.push(script.slice(i, i + CHUNK_SIZE))
    }

    // Sequential translation to respect API rate limits
    const polishedChunks: string[] = []
    for (const chunk of chunks) {
      try {
        const response = await axios.post(
          'https://api.sarvam.ai/translate',
          {
            input: chunk,
            source_language_code: 'en-IN',
            target_language_code: targetCode,
            speaker_gender: 'Male',
            mode: 'formal',
            model: 'mayura:v1',
            enable_preprocessing: false,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'api-subscription-key': env.SARVAM_API_KEY,
            },
            timeout: 60000,
          }
        )
        polishedChunks.push((response.data?.translated_text || chunk) as string)
      } catch {
        polishedChunks.push(chunk)
      }
    }

    const polished = polishedChunks.join('')
    logger.info('Sarvam polish complete', { chars: polished.length })
    return polished
  } catch (error) {
    logger.warn('Sarvam polish failed — using original script', { error: (error as Error).message })
    return null
  }
}

const buildApifyProxyUrl = (): string | undefined => {
  const password = env.APIFY_PROXY_PASSWORD ?? env.APIFY_API_TOKEN
  if (!password) return undefined
  return `http://auto:${password}@proxy.apify.com:8000`
}

const downloadAudio = async (url: string, tmpBase: string): Promise<void> => {
  const ytdlpOpts: Record<string, unknown> = {
    extractAudio: true,
    audioFormat: 'mp3',
    audioQuality: 5,
    output: `${tmpBase}.%(ext)s`,
    noPlaylist: true,
    quiet: true,
    noWarnings: true,
    noCheckCertificate: true,
  }

  const apifyProxy = buildApifyProxyUrl()

  // Primary: yt-dlp via Apify residential proxy (bypasses YouTube bot detection)
  if (apifyProxy) {
    try {
      logger.info('Downloading audio via Apify proxy + yt-dlp', { url })
      await Promise.race([
        ytDlpExec(url, { ...ytdlpOpts, proxy: apifyProxy }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('yt-dlp+Apify timed out after 120s')), 120_000)
        ),
      ])
      logger.info('Audio downloaded via Apify proxy', { url })
      return
    } catch (err) {
      logger.warn('yt-dlp via Apify proxy failed, trying direct', { error: (err as Error).message })
    }
  }

  // Fallback: direct yt-dlp
  await Promise.race([
    ytDlpExec(url, ytdlpOpts),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('yt-dlp direct timed out after 90s')), 90_000)
    ),
  ])
}

export const downloadAndTranscribe = async (
  url: string,
  languageHint?: string
): Promise<TranscribeResult> => {
  const tmpDir = os.tmpdir()
  const tmpBase = path.join(tmpDir, `reel_${Date.now()}`)
  const audioPath = `${tmpBase}.mp3`

  try {
    logger.info('Downloading audio via Apify proxy + yt-dlp', { url })
    await downloadAudio(url, tmpBase)

    if (!fs.existsSync(audioPath)) {
      logger.warn('Audio file not created', { audioPath })
      return { transcript: null, confidence: 'low' }
    }

    const langCode = detectLangCode(languageHint)

    // Try Sarvam first (high confidence), then Groq (also audio-based, high confidence)
    const sarvamTranscript = await transcribeWithSarvam(audioPath, langCode)
    if (sarvamTranscript) {
      return { transcript: sarvamTranscript, confidence: 'high' }
    }

    const groqTranscript = await transcribeWithGroq(audioPath, langCode ?? undefined)
    if (groqTranscript) {
      return { transcript: groqTranscript, confidence: 'high' }
    }

    return { transcript: null, confidence: 'low' }
  } catch (error) {
    logger.error('Audio download/transcription failed', { error: (error as Error).message })
    return { transcript: null, confidence: 'low' }
  } finally {
    if (fs.existsSync(audioPath)) {
      try { fs.unlinkSync(audioPath) } catch { /* ignore */ }
    }
  }
}
