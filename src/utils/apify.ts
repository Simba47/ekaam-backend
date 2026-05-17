export type { InstagramPost } from '../services/apify.service'
import { scrapeInstagramProfile, withApifyRetry } from '../services/apify.service'
import type { InstagramPost } from '../services/apify.service'

export const scrapeInstagramAccount = async (accountUrl: string): Promise<InstagramPost[]> => {
  const profile = await withApifyRetry(
    () => scrapeInstagramProfile(accountUrl),
    2,
    'Instagram account scrape'
  )
  return profile.posts
}
