import OpenAI from 'openai'
import axios from 'axios'
import { env } from '../config/env'
import { logger } from '../utils/logger'

const grok = new OpenAI({
  apiKey: env.GROK_API_KEY,
  baseURL: 'https://api.x.ai/v1',
})

// Use xAI Responses API (/v1/responses) for live web + X search
// This is the replacement for the deprecated search_parameters approach
async function grokLiveSearch(prompt: string): Promise<string> {
  const response = await axios.post(
    'https://api.x.ai/v1/responses',
    {
      model: 'grok-3',
      tools: [{ type: 'web_search' }, { type: 'x_search' }],
      input: [{ role: 'user', content: prompt }],
      max_output_tokens: 8000,
    },
    {
      headers: {
        Authorization: `Bearer ${env.GROK_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 90000,
    }
  )

  // Extract text from output array
  const output: Array<{ type: string; content?: Array<{ type: string; text: string }> }> =
    response.data.output ?? []
  const textBlock = output.find(o => o.type === 'message')
  const text = textBlock?.content?.find(c => c.type === 'output_text')?.text
    ?? textBlock?.content?.map(c => c.text).join('') ?? ''

  // Extract JSON from the response
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  return jsonMatch ? jsonMatch[0] : '{}'
}

// Simple in-memory TTL cache (30 minutes) — avoids need for separate Redis client
const trendCache = new Map<string, { data: ResearchResult; expiresAt: number }>()
const CACHE_TTL_MS = 30 * 60 * 1000

export interface TrendingItem {
  id: string
  type: 'global_trend' | 'india_trend' | 'world_affair' | 'india_affair' | 'sport' | 'entertainment' | 'telugu_trend' | 'new_movie' | 'hashtag'
  topic?: string
  event?: string
  title?: string
  posts_count?: string
  context?: string
  result?: string
  relevance?: string
  broke_at?: string
  source?: string
  state?: string
  language?: string
  genre?: string
  release_date?: string
  ott_platform?: string
  buzz?: string
  x_search_url: string
}

export interface ResearchResult {
  global_trends: TrendingItem[]
  india_trends: TrendingItem[]
  world_current_affairs: TrendingItem[]
  india_current_affairs: TrendingItem[]
  sports: TrendingItem[]
  entertainment: TrendingItem[]
  telugu_trends: TrendingItem[]
  new_movies: TrendingItem[]
  trending_hashtags: TrendingItem[]
  audience_pulse: string
  gap_opportunity: string
  cached_at: string
}

export interface ContentIdea {
  title: string
  angle: string
  hook_preview: string
  tied_to_trend: string
  why_now: string
  viral_potential: 'high' | 'medium' | 'low'
  viral_reason: string
}

function buildXSearchUrl(type: string, query: string, geo?: string): string {
  const base = 'https://x.com/search'
  if (type === 'hashtag') {
    return `${base}?q=%23${encodeURIComponent(query)}&f=live`
  }
  const suffix = geo ?? 'India'
  return `${base}?q=${encodeURIComponent(query + ' ' + suffix)}&f=live&src=typed_query`
}

export async function runResearchAgent(
  niche: string,
  language: string
): Promise<ResearchResult> {
  const cacheKey = `trends:${niche}:${language}`

  const cached = trendCache.get(cacheKey)
  if (cached && Date.now() < cached.expiresAt) {
    logger.info('ResearchAgent: returning cached trends', { niche })
    return cached.data
  }

  const today = new Date().toDateString()
  const prompt = `
Today is ${today}. You have live search access to X (Twitter) and the web. Use it now.

SEARCH INSTRUCTIONS — run these specific searches before answering:
1. Search X for "India trending" to get what is trending on X in India RIGHT NOW
2. Search X for "trending worldwide" or global X trends
3. Search X for "sports trending India" for live sports scores and news
4. Search X for "entertainment trending India" for Bollywood/Tollywood buzz
5. Search web for "Telugu movies releasing this week ${today}" and "box office India this week"
6. Search X for "#Telangana OR #AndhraPradesh trending" for Telugu state news
7. Search verified accounts ONLY: @ANI, @PTI_News, @ndtv, @thehindu, @TimesofIndia, @BBCIndia, @Reuters, @AP, @espncricinfo, @BCCI for credible news

OUTPUT ONLY from verified/official sources. No unverified claims, no rumours, no fan pages.

Output ONLY valid JSON, no other text:

{
  "global_trends": [
    {
      "topic": "<exact trending topic/hashtag from X global trends>",
      "posts_count": "<e.g. '45K posts'>",
      "context": "<one line — what this is about, sourced from official accounts>",
      "source": "<official account or outlet that reported this>"
    }
  ],
  "india_trends": [
    {
      "topic": "<exact trending topic from X India trends>",
      "posts_count": "<e.g. '12K posts'>",
      "context": "<what this is about — from ANI/PTI/NDTV/TheHindu only>",
      "source": "<@ANI | @PTI_News | @ndtv | @thehindu | @TimesofIndia | etc.>"
    }
  ],
  "world_current_affairs": [
    {
      "event": "<exact headline from Reuters/AP/BBC — no paraphrasing>",
      "relevance_to_niche": "<why ${niche} Indian audience cares>",
      "broke_at": "<exact time e.g. '3 hours ago', 'today 9am'>",
      "source": "<Reuters | AP | BBC | official govt handle>"
    }
  ],
  "india_current_affairs": [
    {
      "event": "<exact headline from ANI/PTI/NDTV/TheHindu>",
      "relevance_to_niche": "<why ${niche} creators should cover this>",
      "broke_at": "<exact time>",
      "source": "<@ANI | @PTI_News | @ndtv | @thehindu>"
    }
  ],
  "sports": [
    {
      "event": "<ONLY actual sports events: cricket match scores/results, IPL updates, football, kabaddi, wrestling, athletics — STRICTLY from @BCCI, @espncricinfo, @IPL, @FIFA, @PKLIndia, official team handles. DO NOT put movies, box office, or entertainment here>",
      "result": "<actual score or match result e.g. 'India won by 6 wickets', 'RCB beat MI by 23 runs'>",
      "broke_at": "<when>",
      "source": "<@BCCI | @espncricinfo | @IPL | official team handle>"
    }
  ],
  "entertainment": [
    {
      "topic": "<Bollywood/Tollywood/OTT news trending on X>",
      "context": "<what happened — from official film accounts, verified entertainment pages>",
      "broke_at": "<when>",
      "source": "<official film account or verified entertainment outlet>"
    }
  ],
  "telugu_trends": [
    {
      "topic": "<trending topic in AP/Telangana from X — from official handles @APIIC, @TelanganaCMO, verified politicians, @SakshiTVNews, @TV9Telugu>",
      "state": "<AP | Telangana | Both>",
      "context": "<what happened>",
      "broke_at": "<when>",
      "source": "<official source>"
    }
  ],
  "new_movies": [
    {
      "title": "<movie releasing THIS week or last 7 days — from box office listings or official film Twitter accounts>",
      "language": "<Telugu | Hindi | Tamil | English>",
      "genre": "<genre>",
      "release_date": "<exact date>",
      "ott_platform": "<Netflix | Prime | Hotstar | ZEE5 | theatrical>",
      "buzz": "<real audience reaction from X — quote actual post sentiment, specify positive/mixed/negative>"
    }
  ],
  "trending_hashtags": ["<top trending hashtag on X India right now, without #>"],
  "audience_pulse": "<2 sentences: what is the dominant emotion/conversation in India on X right now, based on actual trending topics>",
  "gap_opportunity": "<content gap: a topic trending heavily that no ${niche} creator has made a video about yet>"
}

RULES:
- Only include information you found from official/verified sources or X trending data
- If you cannot verify something from an official source, skip it
- Include the source field for every item so users can verify
- For movies: only list films with confirmed release dates this week from official film pages
- posts_count should be real numbers from X trending if available, otherwise omit
- broke_at must be specific: "today", "2 hours ago", "yesterday" — not "recently" or "this week"
- sports section: ONLY cricket/IPL/football/kabaddi/athletics match results and scores — movies and box office are NEVER sports, put them in entertainment or new_movies only

Niche: ${niche}
Language: ${language}
`

  try {
    let raw: Record<string, unknown> = {}

    if (env.GROK_API_KEY) {
      const content = await grokLiveSearch(prompt)
      raw = JSON.parse(content)
    } else {
      logger.warn('GROK_API_KEY not set — returning empty trend data')
    }

    type RawTrend = { topic?:string; posts_count?:string; context?:string; source?:string }
    type RawAffair = { event?:string; relevance_to_niche?:string; broke_at?:string; source?:string }
    type RawSport = { event?:string; result?:string; broke_at?:string; source?:string }
    type RawEntertainment = { topic?:string; context?:string; broke_at?:string; source?:string }
    type RawTelugu = { topic?:string; state?:string; context?:string; broke_at?:string; source?:string }
    type RawMovie = { title?:string; language?:string; genre?:string; release_date?:string; ott_platform?:string; buzz?:string }

    const result: ResearchResult = {
      global_trends: ((raw.global_trends ?? []) as RawTrend[]).map((item, i) => ({
        id: `gt_${i}`, type: 'global_trend' as const,
        topic: item.topic, posts_count: item.posts_count, context: item.context, source: item.source,
        x_search_url: buildXSearchUrl('topic', item.topic ?? '', ''),
      })),
      india_trends: ((raw.india_trends ?? []) as RawTrend[]).map((item, i) => ({
        id: `it_${i}`, type: 'india_trend' as const,
        topic: item.topic, posts_count: item.posts_count, context: item.context, source: item.source,
        x_search_url: buildXSearchUrl('topic', item.topic ?? '', 'India'),
      })),
      world_current_affairs: ((raw.world_current_affairs ?? []) as RawAffair[]).map((item, i) => ({
        id: `wca_${i}`, type: 'world_affair' as const,
        event: item.event, relevance: item.relevance_to_niche, broke_at: item.broke_at, source: item.source,
        x_search_url: buildXSearchUrl('topic', item.event ?? '', ''),
      })),
      india_current_affairs: ((raw.india_current_affairs ?? []) as RawAffair[]).map((item, i) => ({
        id: `ica_${i}`, type: 'india_affair' as const,
        event: item.event, relevance: item.relevance_to_niche, broke_at: item.broke_at, source: item.source,
        x_search_url: buildXSearchUrl('topic', item.event ?? '', 'India'),
      })),
      sports: ((raw.sports ?? []) as RawSport[]).map((item, i) => ({
        id: `sp_${i}`, type: 'sport' as const,
        event: item.event, result: item.result, broke_at: item.broke_at, source: item.source,
        x_search_url: buildXSearchUrl('topic', item.event ?? '', 'India'),
      })),
      entertainment: ((raw.entertainment ?? []) as RawEntertainment[]).map((item, i) => ({
        id: `en_${i}`, type: 'entertainment' as const,
        topic: item.topic, context: item.context, broke_at: item.broke_at, source: item.source,
        x_search_url: buildXSearchUrl('topic', item.topic ?? '', ''),
      })),
      telugu_trends: ((raw.telugu_trends ?? []) as RawTelugu[]).map((item, i) => ({
        id: `tg_${i}`, type: 'telugu_trend' as const,
        topic: item.topic, state: item.state, context: item.context, broke_at: item.broke_at, source: item.source,
        x_search_url: buildXSearchUrl('topic', item.topic ?? '', 'Telugu'),
      })),
      new_movies: ((raw.new_movies ?? []) as RawMovie[]).map((item, i) => ({
        id: `mv_${i}`, type: 'new_movie' as const,
        title: item.title, language: item.language, genre: item.genre,
        release_date: item.release_date, ott_platform: item.ott_platform, buzz: item.buzz,
        x_search_url: buildXSearchUrl('topic', (item.title ?? '') + ' movie', ''),
      })),
      trending_hashtags: ((raw.trending_hashtags ?? []) as string[]).map((tag, i) => ({
        id: `ht_${i}`, type: 'hashtag' as const,
        topic: tag,
        x_search_url: buildXSearchUrl('hashtag', tag),
      })),
      audience_pulse: (raw.audience_pulse as string) ?? '',
      gap_opportunity: (raw.gap_opportunity as string) ?? '',
      cached_at: new Date().toISOString(),
    }

    trendCache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS })
    return result
  } catch (error) {
    logger.error('ResearchAgent (Grok) failed', { error: (error as Error).message })
    return {
      global_trends: [], india_trends: [], world_current_affairs: [], india_current_affairs: [],
      sports: [], entertainment: [], telugu_trends: [], new_movies: [], trending_hashtags: [],
      audience_pulse: '', gap_opportunity: '', cached_at: new Date().toISOString(),
    }
  }
}

export function clearTrendCache(niche?: string): void {
  if (niche) {
    for (const key of trendCache.keys()) {
      if (key.startsWith(`trends:${niche}:`)) trendCache.delete(key)
    }
  } else {
    trendCache.clear()
  }
}

export async function generateContentIdeas(
  creatorProfile: object,
  niche: string,
  language: string,
  trendData: ResearchResult
): Promise<ContentIdea[]> {
  if (!env.GROK_API_KEY) return []

  const sk = creatorProfile as Record<string, unknown>
  let voiceSummary = ''
  if (sk.fullAnalysis && typeof sk.fullAnalysis === 'string') {
    try {
      const fa = JSON.parse(sk.fullAnalysis)
      voiceSummary = fa.creator_voice_summary ?? ''
    } catch { /* ignore */ }
  }

  const teluguTopics = trendData.telugu_trends.map(t => t.topic).filter(Boolean).join(', ')
  const movies = trendData.new_movies.map(m => m.title).filter(Boolean).join(', ')
  const worldAffairs = trendData.world_current_affairs.map(a => a.event).filter(Boolean).slice(0, 3).join(', ')
  const indiaAffairs = trendData.india_current_affairs.map(a => a.event).filter(Boolean).slice(0, 3).join(', ')
  const globalTrends = trendData.global_trends.map(t => t.topic).filter(Boolean).slice(0, 5).join(', ')
  const indiaTrends = trendData.india_trends.map(t => t.topic).filter(Boolean).slice(0, 5).join(', ')
  const sports = trendData.sports.map(s => s.event).filter(Boolean).slice(0, 3).join(', ')
  const entertainment = trendData.entertainment.map(e => e.topic).filter(Boolean).slice(0, 3).join(', ')

  const prompt = `
You are a content strategist for an Indian ${niche} creator.
Generate 7 timely video ideas for this specific creator.

Creator voice: ${voiceSummary || 'Indian content creator'}
Niche: ${niche}
Language: ${language}

Trending context:
- Global X trends: ${globalTrends}
- India X trends: ${indiaTrends}
- Telugu/AP/Telangana trends: ${teluguTopics}
- India current affairs: ${indiaAffairs}
- Sports: ${sports}
- Entertainment: ${entertainment}
- World affairs: ${worldAffairs}
- New movies generating buzz: ${movies}
- Audience pulse: ${trendData.audience_pulse}
- Content gap: ${trendData.gap_opportunity}

Output ONLY this JSON:
{
  "ideas": [
    {
      "title": "<video title written in creator's natural style — not formal>",
      "angle": "<what makes this specific and timely — not generic>",
      "hook_preview": "<exact first sentence of the script in their voice>",
      "tied_to_trend": "<which trending topic, affair, or movie this connects to>",
      "why_now": "<why this is relevant THIS week specifically>",
      "viral_potential": "high | medium | low",
      "viral_reason": "<one sentence explanation>"
    }
  ]
}
`

  try {
    const response = await grok.chat.completions.create({
      model: 'grok-3-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
      max_tokens: 2000,
      response_format: { type: 'json_object' },
    })
    const result = JSON.parse(response.choices[0].message.content ?? '{}')
    return (result.ideas ?? []) as ContentIdea[]
  } catch (error) {
    logger.error('generateContentIdeas failed', { error: (error as Error).message })
    return []
  }
}
