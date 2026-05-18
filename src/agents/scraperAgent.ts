import { db } from '../db'
import { trainingSources, trainingContent } from '../db/schema'
import { eq, sql } from 'drizzle-orm'
import axios from 'axios'
import { downloadAndTranscribe } from '../utils/transcribe'
import {
  getChannelByHandle,
  getChannelById,
  getAllPlaylistVideos,
  getVideoDetails,
  getBatchVideoDetails,
  parseISO8601Duration,
  splitTranscript,
  extractChannelIdFromUrl,
  extractVideoIdFromUrl,
} from '../utils/youtube'
import { scrapeInstagramProfile, withApifyRetry } from '../services/apify.service'

import { detectLanguage } from '../utils/language'
import { addAnalyzeJob } from '../jobs/queue'
import { logger } from '../utils/logger'

interface ScrapeInput {
  sourceId: string
  url: string
  type: string
}

export const scraperAgent = {
  async run(input: ScrapeInput): Promise<void> {
    const { sourceId, url, type } = input

    logger.info('ScraperAgent starting', { sourceId, url, type })

    try {
      if (type === 'instagram_reel' || url.includes('instagram.com/reel') || url.includes('instagram.com/p/')) {
        await this.scrapeInstagramReel(sourceId, url)
      } else if (type === 'instagram_account' || (url.includes('instagram.com') && !url.includes('/reel/') && !url.includes('/p/'))) {
        await this.scrapeInstagramAccountSource(sourceId, url)
      } else if (type === 'youtube_video' || url.includes('/watch?v=') || url.includes('youtu.be/')) {
        await this.scrapeVideo(sourceId, url)
      } else {
        await this.scrapeChannel(sourceId, url)
      }
    } catch (error) {
      logger.error('ScraperAgent failed', {
        sourceId,
        error: (error as Error).message,
      })
      await db
        .update(trainingSources)
        .set({
          status: 'failed',
          errorMessage: (error as Error).message,
          updatedAt: new Date(),
        })
        .where(eq(trainingSources.id, sourceId))
      throw error
    }
  },

  async scrapeChannel(sourceId: string, url: string): Promise<void> {
    const identifier = extractChannelIdFromUrl(url)
    if (!identifier) {
      throw new Error(`Cannot extract channel identifier from URL: ${url}`)
    }

    logger.info('Fetching channel details', { identifier })

    let channel
    if (identifier.startsWith('@')) {
      channel = await getChannelByHandle(identifier)
    } else if (identifier.startsWith('UC')) {
      channel = await getChannelById(identifier)
    } else {
      channel = await getChannelByHandle(identifier)
    }

    if (!channel) {
      throw new Error(`Channel not found for identifier: ${identifier}`)
    }

    const uploadsPlaylistId = channel.contentDetails.relatedPlaylists.uploads
    logger.info('Fetching all playlist videos', { playlistId: uploadsPlaylistId })

    const allVideoIds = await getAllPlaylistVideos(uploadsPlaylistId)

    // Batch-fetch durations (50 per API call) to split into short and long
    const SHORT_MAX_SECONDS = 180  // YouTube Shorts are ≤ 3 min
    const SHORT_LIMIT = 50
    const LONG_LIMIT = 50

    const shortIds: string[] = []
    const longIds: string[] = []

    for (let i = 0; i < allVideoIds.length && (shortIds.length < SHORT_LIMIT || longIds.length < LONG_LIMIT); i += 50) {
      const batch = allVideoIds.slice(i, i + 50)
      const details = await getBatchVideoDetails(batch)
      for (const video of details) {
        const duration = parseISO8601Duration(video.contentDetails.duration)
        if (duration <= SHORT_MAX_SECONDS && shortIds.length < SHORT_LIMIT) {
          shortIds.push(video.id)
        } else if (duration > SHORT_MAX_SECONDS && longIds.length < LONG_LIMIT) {
          longIds.push(video.id)
        }
      }
    }

    const videoIds = [...shortIds, ...longIds]
    logger.info(
      `Found ${allVideoIds.length} total — selected ${shortIds.length} short (≤${SHORT_MAX_SECONDS}s) + ${longIds.length} long`,
      { sourceId }
    )

    // totalVideos = videoCount * 2 so progress tracks BOTH scraping AND analyzing phases
    // Each video contributes +1 for scraping and +1 for analyzing = 100% when fully done
    await db
      .update(trainingSources)
      .set({
        status: 'processing',
        totalVideos: videoIds.length * 2,
        name: channel.snippet.title,
        channelId: channel.id,
        updatedAt: new Date(),
      })
      .where(eq(trainingSources.id, sourceId))

    let videosWithTranscripts = 0

    // Process each video
    for (let i = 0; i < videoIds.length; i++) {
      const videoId = videoIds[i]
      // Small delay every 5 videos to avoid yt-dlp getting rate-limited by YouTube
      if (i > 0 && i % 5 === 0) {
        logger.info(`Processed ${i}/${videoIds.length} videos — brief pause before continuing`, { sourceId })
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
      try {
        const hasTranscript = await this.processVideo(sourceId, videoId)
        if (hasTranscript) {
          videosWithTranscripts++
        } else {
          // No transcript = no analyze job will run, count the analyze phase as done too
          await db
            .update(trainingSources)
            .set({
              processedVideos: sql`${trainingSources.processedVideos} + 1`,
              updatedAt: new Date(),
            })
            .where(eq(trainingSources.id, sourceId))
        }
      } catch (error) {
        logger.warn(`Skipping video ${videoId}`, { error: (error as Error).message })
        // Still count both phases for skipped videos so progress doesn't stall
        await db
          .update(trainingSources)
          .set({
            processedVideos: sql`${trainingSources.processedVideos} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(trainingSources.id, sourceId))
      }
    }

    // If NO videos had transcripts, we cannot build a style profile
    if (videosWithTranscripts === 0) {
      await db
        .update(trainingSources)
        .set({
          status: 'failed',
          errorMessage:
            'No transcripts found for any video. YouTube may have disabled captions on this channel.',
          updatedAt: new Date(),
        })
        .where(eq(trainingSources.id, sourceId))
    }
  },

  async scrapeInstagramAccountSource(sourceId: string, url: string): Promise<void> {
    logger.info('Scraping Instagram account via Apify', { sourceId, url })

    await db
      .update(trainingSources)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(trainingSources.id, sourceId))

    const profile = await withApifyRetry(
      () => scrapeInstagramProfile(url),
      2,
      'Instagram account scrape'
    )
    const posts = profile.posts

    if (posts.length === 0) {
      await db
        .update(trainingSources)
        .set({
          status: 'failed',
          errorMessage: 'No posts found for this Instagram account. It may be private or have no posts.',
          updatedAt: new Date(),
        })
        .where(eq(trainingSources.id, sourceId))
      return
    }

    await db
      .update(trainingSources)
      .set({ totalVideos: posts.length * 2, name: url, updatedAt: new Date() })
      .where(eq(trainingSources.id, sourceId))

    for (const post of posts) {
      const caption = post.caption ?? ''
      const hashtags = post.hashtags ?? []

      const [content] = await db
        .insert(trainingContent)
        .values({
          sourceId,
          contentId: post.id,
          contentUrl: post.url ?? url,
          title: caption.slice(0, 100),
          description: caption,
          tags: hashtags,
          fullTranscript: caption || null,
          platform: 'instagram',
          publishedAt: post.timestamp ? new Date(post.timestamp) : new Date(),
        })
        .onConflictDoNothing()
        .returning()

      await db
        .update(trainingSources)
        .set({
          processedVideos: sql`${trainingSources.processedVideos} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(trainingSources.id, sourceId))

      if (content && caption) {
        await addAnalyzeJob({ contentId: content.id, sourceId })
      } else {
        // No content to analyze — count the analyze phase as done
        await db
          .update(trainingSources)
          .set({
            processedVideos: sql`${trainingSources.processedVideos} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(trainingSources.id, sourceId))
      }
    }

    logger.info('Instagram account scrape complete', { sourceId, postCount: posts.length })
  },

  async scrapeInstagramReel(sourceId: string, url: string): Promise<void> {
    logger.info('Scraping Instagram Reel', { sourceId, url })

    const cleanUrl = url.split('?')[0].replace(/\/$/, '') + '/'
    const reelIdMatch = cleanUrl.match(/\/(?:reel|p)\/([\w-]+)\//)
    const reelId = reelIdMatch?.[1] ?? `reel_${Date.now()}`

    await db
      .update(trainingSources)
      .set({ status: 'processing', totalVideos: 2, updatedAt: new Date() })
      .where(eq(trainingSources.id, sourceId))

    // Step 1: Try to get spoken transcript via yt-dlp + Sarvam/Groq
    const audioResult = await downloadAndTranscribe(cleanUrl)
    let transcript: string | null = audioResult.transcript

    // Step 2: Fallback — extract caption from page meta tags
    let caption = ''
    let title = 'Instagram Reel'
    try {
      const res = await axios.get(cleanUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: 10000,
      })
      const html = res.data as string
      const descMatch = html.match(/<meta\s+(?:property="og:description"|name="description")\s+content="([^"]+)"/)
        ?? html.match(/content="([^"]+)"\s+(?:property="og:description"|name="description")/)
      const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/)
        ?? html.match(/content="([^"]+)"\s+property="og:title"/)
      caption = descMatch?.[1]
        ?.replace(/&quot;/g, '"').replace(/&#039;/g, "'")
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') ?? ''
      title = titleMatch?.[1]?.split(' on Instagram')[0]?.trim() ?? 'Instagram Reel'
    } catch (err) {
      logger.warn('Could not fetch Instagram page HTML', { error: (err as Error).message })
    }

    // Use spoken transcript if available, otherwise fall back to caption
    const fullTranscript = transcript ?? caption ?? null

    if (!fullTranscript) {
      await db
        .update(trainingSources)
        .set({
          status: 'failed',
          errorMessage: 'Could not extract content from this reel. It may be private or login-protected.',
          updatedAt: new Date(),
        })
        .where(eq(trainingSources.id, sourceId))
      return
    }

    const transcriptSource = transcript ? 'audio (Whisper)' : 'caption text'
    logger.info(`Instagram Reel content extracted via ${transcriptSource}`, {
      reelId,
      chars: fullTranscript.length,
    })

    const [content] = await db
      .insert(trainingContent)
      .values({
        sourceId,
        contentId: reelId,
        contentUrl: cleanUrl,
        title,
        description: caption,
        fullTranscript,
        hookText: fullTranscript.slice(0, Math.floor(fullTranscript.length * 0.2)),
        bodyText: fullTranscript.slice(
          Math.floor(fullTranscript.length * 0.2),
          Math.floor(fullTranscript.length * 0.8)
        ),
        outroText: fullTranscript.slice(Math.floor(fullTranscript.length * 0.8)),
        platform: 'instagram',
        tags: [],
        language: null,
        publishedAt: new Date(),
        confidence: transcript ? audioResult.confidence : 'low',
        contentType: 'instagram_reel',
      })
      .returning()

    // +1 scraping phase
    await db
      .update(trainingSources)
      .set({
        processedVideos: sql`${trainingSources.processedVideos} + 1`,
        name: title,
        updatedAt: new Date(),
      })
      .where(eq(trainingSources.id, sourceId))

    await addAnalyzeJob({ contentId: content.id, sourceId })
  },

  async scrapeVideo(sourceId: string, url: string): Promise<void> {
    const videoId = extractVideoIdFromUrl(url)
    if (!videoId) {
      throw new Error(`Cannot extract video ID from URL: ${url}`)
    }

    // totalVideos = 2 (1 for scraping + 1 for analyzing)
    await db
      .update(trainingSources)
      .set({
        status: 'processing',
        totalVideos: 2,
        updatedAt: new Date(),
      })
      .where(eq(trainingSources.id, sourceId))

    const hasTranscript = await this.processVideo(sourceId, videoId)

    if (!hasTranscript) {
      // No transcript — count the analyze phase as done too and mark failed
      await db
        .update(trainingSources)
        .set({
          processedVideos: sql`${trainingSources.processedVideos} + 1`,
          status: 'failed',
          errorMessage:
            'No transcript available for this video. YouTube may have disabled captions.',
          updatedAt: new Date(),
        })
        .where(eq(trainingSources.id, sourceId))
    }
  },

  // Returns true if the video had a transcript (will be queued for analysis)
  async processVideo(sourceId: string, videoId: string): Promise<boolean> {
    logger.debug('Processing video', { videoId, sourceId })

    // Check if already processed
    const existing = await db.query.trainingContent.findFirst({
      where: (tc, { eq: eqFn, and }) =>
        and(eqFn(tc.sourceId, sourceId), eqFn(tc.contentId, videoId)),
    })

    if (existing) {
      logger.debug('Video already processed, skipping', { videoId })
      // Still count the scraping phase for this video
      await db
        .update(trainingSources)
        .set({
          processedVideos: sql`${trainingSources.processedVideos} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(trainingSources.id, sourceId))
      return !!existing.fullTranscript
    }

    // Get video metadata
    const video = await getVideoDetails(videoId)
    if (!video) {
      logger.warn('Video not found or private', { videoId })
      return false
    }

    const durationSeconds = parseISO8601Duration(video.contentDetails.duration)

    // Fetch source language to pass as hint to Sarvam
    const source = await db.query.trainingSources.findFirst({
      where: (ts, { eq: eqFn }) => eqFn(ts.id, sourceId),
      columns: { language: true },
    })
    const languageHint = source?.language ?? undefined

    // Step 1: Download audio and transcribe via Sarvam (primary) → Groq (fallback)
    logger.info('Downloading audio for Sarvam transcription', { videoId })
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`
    const audioResult = await downloadAndTranscribe(videoUrl, languageHint)
    let fullTranscript: string | null = audioResult.transcript
    let transcriptConfidence: 'high' | 'low' = audioResult.confidence

    if (!fullTranscript) {
      logger.info('Audio transcription failed — no transcript available', { videoId })
    }

    let hookText: string | null = null
    let bodyText: string | null = null
    let outroText: string | null = null
    let language: string | null = null

    if (fullTranscript) {
      const parts = splitTranscript(fullTranscript, durationSeconds)
      hookText = parts.hook
      bodyText = parts.body
      outroText = parts.outro
      language = detectLanguage(fullTranscript)
    } else {
      logger.debug('No transcript available for video', { videoId })
    }

    // Store in database
    const [content] = await db
      .insert(trainingContent)
      .values({
        sourceId,
        contentId: videoId,
        contentUrl: `https://www.youtube.com/watch?v=${videoId}`,
        title: video.snippet.title,
        description: video.snippet.description,
        tags: video.snippet.tags ?? [],
        durationSeconds,
        language,
        fullTranscript,
        hookText,
        bodyText,
        outroText,
        platform: 'youtube',
        publishedAt: new Date(video.snippet.publishedAt),
        confidence: fullTranscript ? transcriptConfidence : 'low',
        contentType: durationSeconds <= 180 ? 'short' : 'long',
      })
      .returning()

    // +1 for the scraping phase
    await db
      .update(trainingSources)
      .set({
        processedVideos: sql`${trainingSources.processedVideos} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(trainingSources.id, sourceId))

    // Queue for analysis if transcript exists (+1 for analyze phase will happen in analyzeWorker)
    if (fullTranscript && content) {
      await addAnalyzeJob({ contentId: content.id, sourceId })
    }

    logger.debug('Video processed successfully', { videoId, hasTranscript: !!fullTranscript })
    return !!fullTranscript
  },
}
