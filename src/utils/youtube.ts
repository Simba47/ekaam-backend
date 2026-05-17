import axios from 'axios'
import { env } from '../config/env'
import { logger } from './logger'
import { scrapeYouTubeCaptions, withApifyRetry } from '../services/apify.service'

const YT_BASE = 'https://www.googleapis.com/youtube/v3'

interface VideoSnippet {
  title: string
  description: string
  tags?: string[]
  publishedAt: string
  channelTitle: string
}

interface VideoContentDetails {
  duration: string
}

export interface YouTubeVideo {
  id: string
  snippet: VideoSnippet
  contentDetails: VideoContentDetails
}

export interface PlaylistItem {
  snippet: {
    resourceId: {
      videoId: string
    }
  }
}

export interface ChannelDetails {
  id: string
  snippet: {
    title: string
    description: string
  }
  contentDetails: {
    relatedPlaylists: {
      uploads: string
    }
  }
}

interface CaptionTrack {
  id: string
  snippet: {
    language: string
    trackKind: string
    name: string
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const withRetry = async <T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 2000
): Promise<T> => {
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt - 1)
        logger.warn(`YouTube API attempt ${attempt} failed, retrying in ${delay}ms`, {
          error: lastError.message,
        })
        await sleep(delay)
      }
    }
  }
  throw lastError
}

export const getChannelByHandle = async (handle: string): Promise<ChannelDetails | null> => {
  return withRetry(async () => {
    const cleanHandle = handle.startsWith('@') ? handle.slice(1) : handle
    const res = await axios.get(`${YT_BASE}/channels`, {
      params: {
        key: env.YOUTUBE_API_KEY,
        forHandle: cleanHandle,
        part: 'id,snippet,contentDetails',
      },
    })
    return res.data.items?.[0] ?? null
  })
}

export const getChannelById = async (channelId: string): Promise<ChannelDetails | null> => {
  return withRetry(async () => {
    const res = await axios.get(`${YT_BASE}/channels`, {
      params: {
        key: env.YOUTUBE_API_KEY,
        id: channelId,
        part: 'id,snippet,contentDetails',
      },
    })
    return res.data.items?.[0] ?? null
  })
}

export const getAllPlaylistVideos = async (playlistId: string): Promise<string[]> => {
  const videoIds: string[] = []
  let pageToken: string | undefined

  do {
    const result = await withRetry(async () => {
      const res = await axios.get(`${YT_BASE}/playlistItems`, {
        params: {
          key: env.YOUTUBE_API_KEY,
          playlistId,
          part: 'snippet',
          maxResults: 50,
          pageToken,
        },
      })
      return res.data
    })

    for (const item of result.items as PlaylistItem[]) {
      videoIds.push(item.snippet.resourceId.videoId)
    }

    pageToken = result.nextPageToken
  } while (pageToken)

  return videoIds
}

export const getVideoDetails = async (videoId: string): Promise<YouTubeVideo | null> => {
  return withRetry(async () => {
    const res = await axios.get(`${YT_BASE}/videos`, {
      params: {
        key: env.YOUTUBE_API_KEY,
        id: videoId,
        part: 'snippet,contentDetails',
      },
    })
    return res.data.items?.[0] ?? null
  })
}

// Fetch details for up to 50 video IDs in one API call
export const getBatchVideoDetails = async (videoIds: string[]): Promise<YouTubeVideo[]> => {
  if (videoIds.length === 0) return []
  return withRetry(async () => {
    const res = await axios.get(`${YT_BASE}/videos`, {
      params: {
        key: env.YOUTUBE_API_KEY,
        id: videoIds.join(','),
        part: 'snippet,contentDetails',
        maxResults: 50,
      },
    })
    return res.data.items ?? []
  })
}

export const getVideoCaptions = async (videoId: string): Promise<CaptionTrack[]> => {
  return withRetry(async () => {
    const res = await axios.get(`${YT_BASE}/captions`, {
      params: {
        key: env.YOUTUBE_API_KEY,
        videoId,
        part: 'snippet',
      },
    })
    return res.data.items ?? []
  })
}

export const fetchTranscript = async (videoId: string): Promise<string | null> => {
  // Method 1: youtube-transcript library (most reliable)
  try {
    const { YoutubeTranscript } = await import('youtube-transcript')
    const tracks = await YoutubeTranscript.fetchTranscript(videoId)
    if (tracks && tracks.length > 0) {
      const text = tracks.map((t) => t.text).join(' ').trim()
      if (text) {
        logger.debug(`Got transcript via youtube-transcript for ${videoId}`, { chars: text.length })
        return text
      }
    }
  } catch (err) {
    logger.debug(`youtube-transcript failed for ${videoId}, trying HTML scrape`, {
      error: (err as Error).message,
    })
  }

  // Method 2: HTML scraping fallback
  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`
    const pageRes = await axios.get(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })

    const html = pageRes.data as string

    // Try both escaped and unescaped formats
    const captionMatch =
      html.match(/"captionTracks":(\[.*?\])/) ||
      html.match(/"captionTracks":\s*(\[[\s\S]*?\])\s*,\s*"/)

    if (!captionMatch) {
      logger.debug(`No caption tracks found in HTML for video ${videoId}`)
      return null
    }

    const captionTracks = JSON.parse(captionMatch[1].replace(/\\u0026/g, '&')) as Array<{
      baseUrl: string
      languageCode: string
      kind?: string
    }>

    if (!captionTracks.length) return null

    // Prefer: any ASR (auto-generated), then manual captions, any language
    const preferred =
      captionTracks.find((t) => t.kind === 'asr' && t.languageCode === 'en') ||
      captionTracks.find((t) => t.kind === 'asr') ||
      captionTracks[0]

    if (!preferred?.baseUrl) return null

    const captionRes = await axios.get(preferred.baseUrl)
    const xmlText = captionRes.data as string

    const textMatches = xmlText.match(/<text[^>]*>([\s\S]*?)<\/text>/g)
    if (!textMatches) return null

    const fullText = textMatches
      .map((tag) =>
        tag
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .trim()
      )
      .filter(Boolean)
      .join(' ')

    if (fullText) {
      logger.debug(`Got transcript via HTML scrape for ${videoId}`, { chars: fullText.length })
      return fullText
    }
  } catch (error) {
    logger.debug(`HTML scrape failed for video ${videoId}`, {
      error: (error as Error).message,
    })
  }

  // Method 3: Apify captions fallback (residential proxy bypasses region/bot blocks)
  if (env.APIFY_API_TOKEN) {
    try {
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`
      const result = await withApifyRetry(
        () => scrapeYouTubeCaptions(videoUrl),
        1,
        `Apify captions for ${videoId}`
      )
      if (result.captions) {
        logger.debug(`Got transcript via Apify captions for ${videoId}`, { chars: result.captions.length })
        return result.captions
      }
    } catch (err) {
      logger.debug(`Apify captions failed for ${videoId}`, { error: (err as Error).message })
    }
  }

  logger.debug(`All transcript methods failed for video ${videoId}`)
  return null
}

export const parseISO8601Duration = (duration: string): number => {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return 0
  const hours = parseInt(match[1] ?? '0', 10)
  const minutes = parseInt(match[2] ?? '0', 10)
  const seconds = parseInt(match[3] ?? '0', 10)
  return hours * 3600 + minutes * 60 + seconds
}

export const extractChannelIdFromUrl = (url: string): string | null => {
  // Handle /channel/UCxxxxxx format
  const channelMatch = url.match(/\/channel\/(UC[\w-]+)/)
  if (channelMatch) return channelMatch[1]

  // Handle /c/channelname format
  const cMatch = url.match(/\/c\/([\w-]+)/)
  if (cMatch) return cMatch[1]

  // Handle /@handle format
  const handleMatch = url.match(/\/@([\w.-]+)/)
  if (handleMatch) return `@${handleMatch[1]}`

  return null
}

export const extractVideoIdFromUrl = (url: string): string | null => {
  // Handle youtu.be/VIDEO_ID short URLs
  const shortMatch = url.match(/youtu\.be\/([\w-]{11})/)
  if (shortMatch) return shortMatch[1]

  // Handle youtube.com/watch?v=VIDEO_ID
  const longMatch = url.match(/[?&]v=([\w-]{11})/)
  if (longMatch) return longMatch[1]

  // Handle youtube.com/shorts/VIDEO_ID
  const shortsMatch = url.match(/youtube\.com\/shorts\/([\w-]{11})/)
  if (shortsMatch) return shortsMatch[1]

  return null
}

export const splitTranscript = (
  transcript: string,
  durationSeconds: number
): { hook: string; body: string; outro: string } => {
  const words = transcript.split(' ')
  const totalWords = words.length

  if (totalWords === 0) {
    return { hook: '', body: '', outro: '' }
  }

  // Approximate: 30s out of total duration
  const hookRatio = Math.min(30 / durationSeconds, 0.2)
  const outroRatio = Math.min(30 / durationSeconds, 0.2)

  const hookEnd = Math.floor(totalWords * hookRatio)
  const outroStart = Math.floor(totalWords * (1 - outroRatio))

  return {
    hook: words.slice(0, hookEnd).join(' '),
    body: words.slice(hookEnd, outroStart).join(' '),
    outro: words.slice(outroStart).join(' '),
  }
}
