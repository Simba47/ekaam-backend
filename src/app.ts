import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import rateLimit from 'express-rate-limit'
import { env } from './config/env'
import { errorHandler, notFound } from './middleware/errorHandler'

import adminRoutes from './modules/admin/admin.routes'
import authRoutes from './modules/auth/auth.routes'
import scraperRoutes from './modules/scraper/scraper.routes'
import generatorRoutes from './modules/generator/generator.routes'
import scriptsRoutes from './modules/scripts/scripts.routes'
import instagramRoutes from './modules/instagram/instagram.routes'
import inspirationsRoutes from './modules/inspirations/inspirations.routes'
import clientTrainingRoutes from './modules/client-training/client-training.routes'
import trendsRouter from './modules/trends/trends.router'

const app = express()

app.set('trust proxy', 1)

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet())

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  env.FRONTEND_ADMIN_URL,
  env.FRONTEND_CLIENT_URL,
  'http://localhost:5173',
  'http://localhost:5174',
]

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true)
    const isAllowed =
      allowedOrigins.includes(origin) ||
      /^https:\/\/ekaam-(client-portal|admin)[\w-]*\.vercel\.app$/.test(origin)
    callback(null, isAllowed)
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

app.use(compression())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Global: 300 req / 15 min per IP — stops basic floods
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests — please try again later' },
})

// Script generation is expensive (AI + streaming) — tighter limit
const generateLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute window
  max: 5,                    // 5 generations per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Script generation rate limit reached — wait a moment' },
})

// Training (scrape jobs) — very tight, one job takes minutes
const trainingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour window
  max: 10,                   // 10 source additions per hour per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Training source limit reached — try again in an hour' },
})

app.use(globalLimiter)

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/v1/admin',           adminRoutes)
app.use('/api/v1/auth',            authRoutes)
app.use('/api/v1/scraper',         scraperRoutes)
app.use('/api/v1/generate',        generateLimiter, generatorRoutes)
app.use('/api/v1/scripts',         scriptsRoutes)
app.use('/api/v1/instagram',       instagramRoutes)
app.use('/api/v1/inspirations',    inspirationsRoutes)
app.use('/api/v1/training',        trainingLimiter, clientTrainingRoutes)
app.use('/api/v1/trends',          trendsRouter)

app.use(notFound)
app.use(errorHandler)

export default app
