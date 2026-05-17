import Bull from 'bull'
import { env } from '../config/env'
import { logger } from '../utils/logger'
import { runScrapeJobDirect, runAnalyzeJobDirect, runInstagramJobDirect } from './directRunner'

// Track whether Redis is reachable — checked once at startup via TCP probe
let redisAvailable = false

const checkRedis = (): Promise<boolean> =>
  new Promise((resolve) => {
    const net = require('net') as typeof import('net')
    const url = new URL(env.REDIS_URL.replace(/^redis:\/\//, 'http://'))
    const socket = net.createConnection(
      { host: url.hostname || '127.0.0.1', port: Number(url.port) || 6379, timeout: 2000 },
      () => { socket.destroy(); resolve(true) }
    )
    socket.on('error', () => { socket.destroy(); resolve(false) })
    socket.on('timeout', () => { socket.destroy(); resolve(false) })
  })

checkRedis().then((ok) => {
  redisAvailable = ok
  logger.info(ok ? 'Redis connected — using Bull queues' : 'Redis unavailable — using direct runner')
})

export interface ScrapeJobData {
  sourceId: string
  url: string
  type: 'youtube_channel' | 'youtube_video' | 'instagram_account'
}

export interface AnalyzeJobData {
  contentId: string
  sourceId: string
}

export interface InstagramJobData {
  userId?: string
  sourceId?: string
  accountUrl: string
  accessToken?: string
}

const defaultJobOptions: Bull.JobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 5000,
  },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 50 },
}

export const scrapeQueue = new Bull<ScrapeJobData>('scrape', {
  redis: env.REDIS_URL,
  defaultJobOptions,
  settings: {
    lockDuration: 7_200_000,  // 2 hours — scraping 100 videos takes a long time
    stalledInterval: 60_000,  // check for stalled jobs every 60s (not every 5s)
    maxStalledCount: 1,
  },
})

export const analyzeQueue = new Bull<AnalyzeJobData>('analyze', {
  redis: env.REDIS_URL,
  defaultJobOptions,
})

export const instagramQueue = new Bull<InstagramJobData>('instagram', {
  redis: env.REDIS_URL,
  defaultJobOptions,
})

// Queue event logging
const setupQueueEvents = (queue: Bull.Queue, name: string) => {
  queue.on('error', (error) => {
    // Suppress Redis reconnect noise when direct runner is active
    if (!redisAvailable) return
    logger.error(`${name} queue error`, { error: error.message })
  })

  queue.on('failed', (job, error) => {
    logger.error(`${name} job ${job.id} failed`, {
      data: job.data,
      error: error.message,
      attempts: job.attemptsMade,
    })
  })

  queue.on('completed', (job) => {
    logger.info(`${name} job ${job.id} completed`, { data: job.data })
  })

  queue.on('stalled', (job) => {
    logger.warn(`${name} job ${job.id} stalled`, { data: job.data })
  })
}

setupQueueEvents(scrapeQueue, 'scrape')
setupQueueEvents(analyzeQueue, 'analyze')
setupQueueEvents(instagramQueue, 'instagram')

export const addScrapeJob = async (data: ScrapeJobData): Promise<void> => {
  if (!redisAvailable) {
    logger.warn('Redis unavailable — running scrape job directly', { sourceId: data.sourceId })
    runScrapeJobDirect(data)
    return
  }
  try {
    const job = await scrapeQueue.add(data)
    logger.info('Added scrape job to queue', { jobId: job.id, sourceId: data.sourceId })
  } catch {
    logger.warn('Redis failed — running scrape job directly', { sourceId: data.sourceId })
    runScrapeJobDirect(data)
  }
}

export const addAnalyzeJob = async (data: AnalyzeJobData): Promise<void> => {
  if (!redisAvailable) {
    logger.warn('Redis unavailable — running analyze job directly', { contentId: data.contentId })
    runAnalyzeJobDirect(data)
    return
  }
  try {
    const job = await analyzeQueue.add(data)
    logger.debug('Added analyze job to queue', { jobId: job.id, contentId: data.contentId })
  } catch {
    logger.warn('Redis failed — running analyze job directly', { contentId: data.contentId })
    runAnalyzeJobDirect(data)
  }
}

export const addInstagramJob = async (data: InstagramJobData): Promise<void> => {
  if (!redisAvailable) {
    logger.warn('Redis unavailable — running instagram job directly', { url: data.accountUrl })
    runInstagramJobDirect(data)
    return
  }
  try {
    const job = await instagramQueue.add(data)
    logger.info('Added instagram job to queue', { jobId: job.id, url: data.accountUrl })
  } catch {
    logger.warn('Redis failed — running instagram job directly', { url: data.accountUrl })
    runInstagramJobDirect(data)
  }
}

export const getJobProgress = async (
  _sourceId: string
): Promise<{
  waiting: number
  active: number
  completed: number
  failed: number
}> => {
  const [scrapeWaiting, scrapeActive, analyzeWaiting, analyzeActive] = await Promise.all([
    scrapeQueue.getWaitingCount(),
    scrapeQueue.getActiveCount(),
    analyzeQueue.getWaitingCount(),
    analyzeQueue.getActiveCount(),
  ])

  return {
    waiting: scrapeWaiting + analyzeWaiting,
    active: scrapeActive + analyzeActive,
    completed: 0,
    failed: 0,
  }
}

export const closeQueues = async (): Promise<void> => {
  await Promise.all([
    scrapeQueue.close(),
    analyzeQueue.close(),
    instagramQueue.close(),
  ])
  logger.info('All queues closed')
}
