import axios from 'axios'
import { db } from '../../db'
import {
  trainingSources,
  trainingContent,
  users,
  userPersonalStyle,
} from '../../db/schema'
import { eq } from 'drizzle-orm'
import { scrapeInstagramAccount } from '../../utils/apify'
import { addAnalyzeJob, addInstagramJob } from '../../jobs/queue'
import { env } from '../../config/env'
import { createError } from '../../middleware/errorHandler'
import { logger } from '../../utils/logger'

export const instagramService = {
  // Phase 2: Admin scrapes an Instagram account
  async scrapeAccount(data: { url: string; sourceId: string }) {
    const { url, sourceId } = data

    const posts = await scrapeInstagramAccount(url)

    await db
      .update(trainingSources)
      .set({ totalVideos: posts.length, updatedAt: new Date() })
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
          fullTranscript: caption,
          platform: 'instagram',
          publishedAt: post.timestamp ? new Date(post.timestamp) : undefined,
        })
        .onConflictDoNothing()
        .returning()

      if (content) await addAnalyzeJob({ contentId: content.id, sourceId })
    }

    await db
      .update(trainingSources)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(eq(trainingSources.id, sourceId))

    logger.info('Instagram account scraped', { sourceId, postCount: posts.length })
  },

  // Phase 3: OAuth redirect
  getOAuthUrl(): string {
    if (!env.INSTAGRAM_APP_ID || !env.INSTAGRAM_REDIRECT_URI) {
      throw createError('Instagram OAuth not configured', 500)
    }

    const params = new URLSearchParams({
      client_id: env.INSTAGRAM_APP_ID,
      redirect_uri: env.INSTAGRAM_REDIRECT_URI,
      scope: 'user_profile,user_media',
      response_type: 'code',
    })

    return `https://api.instagram.com/oauth/authorize?${params.toString()}`
  },

  // Phase 3: OAuth callback — exchange code for token
  async handleOAuthCallback(code: string, userId: string): Promise<void> {
    if (!env.INSTAGRAM_APP_ID || !env.INSTAGRAM_APP_SECRET || !env.INSTAGRAM_REDIRECT_URI) {
      throw createError('Instagram OAuth not configured', 500)
    }

    const tokenRes = await axios.post(
      'https://api.instagram.com/oauth/access_token',
      new URLSearchParams({
        client_id: env.INSTAGRAM_APP_ID,
        client_secret: env.INSTAGRAM_APP_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: env.INSTAGRAM_REDIRECT_URI,
        code,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    )

    const { access_token, user_id } = tokenRes.data as {
      access_token: string
      user_id: string
    }

    // Get long-lived token
    const longLivedRes = await axios.get(
      'https://graph.instagram.com/access_token',
      {
        params: {
          grant_type: 'ig_exchange_token',
          client_secret: env.INSTAGRAM_APP_SECRET,
          access_token,
        },
      }
    )

    const { access_token: longToken, expires_in } = longLivedRes.data as {
      access_token: string
      expires_in: number
    }

    // Get username
    const profileRes = await axios.get(`https://graph.instagram.com/${user_id}`, {
      params: {
        fields: 'username',
        access_token: longToken,
      },
    })

    const { username } = profileRes.data as { username: string }

    const expiry = new Date(Date.now() + expires_in * 1000)

    await db
      .update(users)
      .set({
        instagramConnected: true,
        instagramUsername: username,
        instagramAccessToken: longToken,
        instagramTokenExpiry: expiry,
        trainingStatus: 'pending',
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))

    // Queue Instagram content scraping for this user
    await addInstagramJob({
      userId,
      accountUrl: `https://www.instagram.com/${username}/`,
      accessToken: longToken,
    })

    logger.info('Instagram OAuth complete', { userId, username })
  },

  async getTrainingStatus(userId: string) {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    })

    if (!user) {
      throw createError('User not found', 404)
    }

    const personalStyle = await db.query.userPersonalStyle.findFirst({
      where: eq(userPersonalStyle.userId, userId),
    })

    return {
      instagramConnected: user.instagramConnected,
      instagramUsername: user.instagramUsername,
      trainingStatus: user.trainingStatus,
      hasStyleProfile: !!personalStyle,
    }
  },
}
