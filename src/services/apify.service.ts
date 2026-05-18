import { ApifyClient } from 'apify-client'
import { env } from '../config/env'
import { logger } from '../utils/logger'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const PROXY_CONFIG = {
  useApifyProxy: true,
  apifyProxyGroups: ['RESIDENTIAL'],
  apifyProxyCountry: 'IN',
}

function getClient(): ApifyClient {
  if (!env.APIFY_API_TOKEN) throw new Error('APIFY_API_TOKEN is not configured')
  return new ApifyClient({ token: env.APIFY_API_TOKEN })
}

export interface InstagramPost {
  id: string
  type: string
  caption?: string
  hashtags?: string[]
  timestamp?: string
  videoUrl?: string
  url?: string
  likesCount?: number
  commentsCount?: number
  videoViewCount?: number
}

export interface InstagramProfile {
  username: string
  fullName?: string
  biography?: string
  followersCount?: number
  followsCount?: number
  postsCount?: number
  isVerified?: boolean
  profilePicUrl?: string
  posts: InstagramPost[]
}

export interface YouTubeVideo {
  id: string
  title?: string
  description?: string
  url?: string
  channelName?: string
  publishedAt?: string
  viewCount?: number
  likeCount?: number
  duration?: string
  thumbnailUrl?: string
}

export interface YouTubeChannel {
  id?: string
  name?: string
  url?: string
  subscriberCount?: number
  videos: YouTubeVideo[]
}

export interface YouTubeCaption {
  videoId: string
  videoUrl: string
  captions: string
  language?: string
}

export async function withApifyRetry<T>(
  fn: () => Promise<T>,
  retries = 2,
  label = 'Apify call'
): Promise<T> {
  let lastError: Error | undefined
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err as Error
      logger.warn(`${label} failed (attempt ${attempt + 1}/${retries + 1})`, {
        error: lastError.message,
      })
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)))
      }
    }
  }
  throw lastError
}

export async function scrapeInstagramProfile(
  username: string,
  maxPosts = 30
): Promise<InstagramProfile> {
  const client = getClient()
  const profileUrl = username.startsWith('http')
    ? username
    : `https://www.instagram.com/${username.replace('@', '')}/`

  logger.info('Scraping Instagram profile via Apify', { profileUrl, maxPosts })

  const run = await client.actor('apify/instagram-scraper').call({
    directUrls: [profileUrl],
    resultsType: 'posts',
    resultsLimit: maxPosts,
    proxy: PROXY_CONFIG,
  })

  const { items } = await client.dataset(run.defaultDatasetId).listItems()

  if (!items || items.length === 0) {
    throw new Error(`APIFY_EMPTY_RESULT: No posts found for Instagram profile ${username}. The account may be private or the URL is invalid.`)
  }

  const first = items[0] as Record<string, unknown>
  const profile: InstagramProfile = {
    username: (first.ownerUsername as string) ?? username,
    fullName: first.ownerFullName as string | undefined,
    biography: first.biography as string | undefined,
    followersCount: first.followersCount as number | undefined,
    followsCount: first.followsCount as number | undefined,
    postsCount: first.postsCount as number | undefined,
    isVerified: first.verified as boolean | undefined,
    profilePicUrl: first.profilePicUrl as string | undefined,
    posts: items.map((item) => {
      const p = item as Record<string, unknown>
      return {
        id: (p.id as string) ?? (p.shortCode as string) ?? String(Date.now()),
        type: (p.type as string) ?? 'post',
        caption: p.caption as string | undefined,
        hashtags: (p.hashtags as string[]) ?? [],
        timestamp: p.timestamp as string | undefined,
        videoUrl: p.videoUrl as string | undefined,
        url: p.url as string | undefined,
        likesCount: p.likesCount as number | undefined,
        commentsCount: p.commentsCount as number | undefined,
        videoViewCount: p.videoViewCount as number | undefined,
      }
    }),
  }

  logger.info('Instagram profile scrape complete', {
    username,
    postCount: profile.posts.length,
  })
  return profile
}

export async function scrapeInstagramHashtag(
  hashtag: string,
  maxPosts = 30
): Promise<InstagramPost[]> {
  const client = getClient()
  const tag = hashtag.replace('#', '')
  const hashtagUrl = `https://www.instagram.com/explore/tags/${tag}/`

  logger.info('Scraping Instagram hashtag via Apify', { hashtag: tag, maxPosts })

  const run = await client.actor('apify/instagram-scraper').call({
    directUrls: [hashtagUrl],
    resultsType: 'posts',
    resultsLimit: maxPosts,
    proxy: PROXY_CONFIG,
  })

  const { items } = await client.dataset(run.defaultDatasetId).listItems()

  if (!items || items.length === 0) {
    throw new Error(`APIFY_EMPTY_RESULT: No posts found for hashtag #${tag}.`)
  }

  return items.map((item) => {
    const p = item as Record<string, unknown>
    return {
      id: (p.id as string) ?? (p.shortCode as string) ?? String(Date.now()),
      type: (p.type as string) ?? 'post',
      caption: p.caption as string | undefined,
      hashtags: (p.hashtags as string[]) ?? [],
      timestamp: p.timestamp as string | undefined,
      videoUrl: p.videoUrl as string | undefined,
      url: p.url as string | undefined,
      likesCount: p.likesCount as number | undefined,
      commentsCount: p.commentsCount as number | undefined,
      videoViewCount: p.videoViewCount as number | undefined,
    }
  })
}

export async function scrapeYouTubeChannel(
  channelUrl: string,
  maxVideos = 100
): Promise<YouTubeChannel> {
  const client = getClient()

  logger.info('Scraping YouTube channel via Apify', { channelUrl, maxVideos })

  const run = await client.actor('streamers/youtube-scraper').call({
    startUrls: [{ url: channelUrl }],
    maxResults: maxVideos,
    proxy: PROXY_CONFIG,
  })

  const { items } = await client.dataset(run.defaultDatasetId).listItems()

  if (!items || items.length === 0) {
    throw new Error(`APIFY_EMPTY_RESULT: No videos found for YouTube channel ${channelUrl}.`)
  }

  const firstItem = items[0] as Record<string, unknown>
  const channel: YouTubeChannel = {
    id: firstItem.channelId as string | undefined,
    name: firstItem.channelName as string | undefined,
    url: channelUrl,
    subscriberCount: firstItem.numberOfSubscribers as number | undefined,
    videos: items.map((item) => {
      const v = item as Record<string, unknown>
      return {
        id: (v.id as string) ?? (v.videoId as string) ?? '',
        title: v.title as string | undefined,
        description: v.description as string | undefined,
        url: (v.url as string) ?? (v.videoId ? `https://www.youtube.com/watch?v=${v.videoId}` : undefined),
        channelName: v.channelName as string | undefined,
        publishedAt: v.date as string | undefined,
        viewCount: v.viewCount as number | undefined,
        likeCount: v.likes as number | undefined,
        duration: v.duration as string | undefined,
        thumbnailUrl: v.thumbnailUrl as string | undefined,
      }
    }),
  }

  logger.info('YouTube channel scrape complete', {
    channelUrl,
    videoCount: channel.videos.length,
  })
  return channel
}

export async function scrapeYouTubeVideos(
  videoUrls: string[]
): Promise<YouTubeVideo[]> {
  const client = getClient()

  logger.info('Scraping YouTube videos via Apify', { count: videoUrls.length })

  const run = await client.actor('streamers/youtube-scraper').call({
    startUrls: videoUrls.map(url => ({ url })),
    proxy: PROXY_CONFIG,
  })

  const { items } = await client.dataset(run.defaultDatasetId).listItems()

  return items.map((item) => {
    const v = item as Record<string, unknown>
    return {
      id: (v.id as string) ?? (v.videoId as string) ?? '',
      title: v.title as string | undefined,
      description: v.description as string | undefined,
      url: (v.url as string) ?? (v.videoId ? `https://www.youtube.com/watch?v=${v.videoId}` : undefined),
      channelName: v.channelName as string | undefined,
      publishedAt: v.date as string | undefined,
      viewCount: v.viewCount as number | undefined,
      likeCount: v.likes as number | undefined,
      duration: v.duration as string | undefined,
      thumbnailUrl: v.thumbnailUrl as string | undefined,
    }
  })
}

export async function getYouTubeStreamUrl(videoUrl: string): Promise<string | null> {
  const client = getClient()

  logger.info('Getting YouTube stream URL via Apify', { videoUrl })

  const run = await client.actor('streamers/youtube-scraper').call({
    startUrls: [{ url: videoUrl }],
    proxy: PROXY_CONFIG,
    downloadVideos: false,
    downloadSubtitles: false,
    saveSubtitles: false,
  })

  const { items } = await client.dataset(run.defaultDatasetId).listItems()
  if (!items || items.length === 0) return null

  const item = items[0] as Record<string, unknown>
  // Prefer direct stream URL over YouTube watch URL
  const streamUrl = (item.streamUrl as string)
    ?? (item.videoUrl as string)
    ?? (item.directUrl as string)
    ?? null

  if (streamUrl && !streamUrl.includes('youtube.com') && !streamUrl.includes('youtu.be')) {
    logger.info('Got direct stream URL from Apify', { streamUrl: streamUrl.slice(0, 80) })
    return streamUrl
  }

  logger.warn('Apify did not return a direct stream URL', { url: videoUrl })
  return null
}

export async function scrapeYouTubeCaptions(
  videoUrl: string,
  preferredLanguage = 'en'
): Promise<YouTubeCaption> {
  const client = getClient()

  logger.info('Scraping YouTube captions via Apify', { videoUrl, preferredLanguage })

  const run = await client.actor('streamers/youtube-scraper').call({
    startUrls: [{ url: videoUrl }],
    subtitlesLanguage: preferredLanguage,
    proxy: PROXY_CONFIG,
  })

  const { items } = await client.dataset(run.defaultDatasetId).listItems()

  if (!items || items.length === 0) {
    throw new Error(`APIFY_EMPTY_RESULT: No captions found for ${videoUrl}.`)
  }

  const item = items[0] as Record<string, unknown>
  const subtitles = item.subtitles as Array<{ text: string }> | undefined
  const captions = subtitles?.map(s => s.text).join(' ').trim() ?? ''

  if (!captions) {
    throw new Error(`APIFY_EMPTY_RESULT: Captions are empty for ${videoUrl}.`)
  }

  const videoIdMatch = videoUrl.match(/[?&]v=([^&]+)/) ?? videoUrl.match(/youtu\.be\/([^?]+)/)
  return {
    videoId: videoIdMatch?.[1] ?? '',
    videoUrl,
    captions,
    language: item.subtitlesLanguage as string ?? preferredLanguage,
  }
}
