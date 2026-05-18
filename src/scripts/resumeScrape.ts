import { addScrapeJob } from '../jobs/queue'
import { logger } from '../utils/logger'

const SOURCE_ID = '33c80624-8589-46ef-acee-e3503569d454'
const URL = 'https://www.youtube.com/@soulfulsouthvlogss'
const TYPE = 'youtube_channel' as const

async function main() {
  logger.info('Triggering resume scrape job', { sourceId: SOURCE_ID })
  await addScrapeJob({ sourceId: SOURCE_ID, url: URL, type: TYPE })
  logger.info('Scrape job queued — will skip already-processed videos and continue from where it stopped')
  // Give the direct runner a moment to start
  await new Promise(r => setTimeout(r, 2000))
}

main().catch(console.error)
