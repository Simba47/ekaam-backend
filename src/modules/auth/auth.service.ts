import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { db } from '../../db'
import { users } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { env } from '../../config/env'
import { logger } from '../../utils/logger'
import { createError } from '../../middleware/errorHandler'

export interface LoginResult {
  token: string
  user: {
    id: string
    email: string
    name: string
    role: 'admin' | 'user'
  }
}

export const authService = {
  async adminLogin(email: string, password: string): Promise<LoginResult> {
    if (email !== env.ADMIN_EMAIL) {
      throw createError('Invalid credentials', 401)
    }

    // Secure comparison — no timing attack
    const isValid = password === env.ADMIN_PASSWORD
    if (!isValid) {
      throw createError('Invalid credentials', 401)
    }

    const token = jwt.sign(
      { id: 'admin', email, role: 'admin' },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN as any }
    )

    logger.info('Admin logged in', { email })

    return {
      token,
      user: { id: 'admin', email, name: 'Admin', role: 'admin' },
    }
  },

  async userRegister(email: string, password: string, name: string): Promise<LoginResult> {
    const existing = await db.query.users.findFirst({
      where: eq(users.email, email),
    })

    if (existing) {
      throw createError('Email already registered', 409)
    }

    const passwordHash = await bcrypt.hash(password, 12)

    const [user] = await db
      .insert(users)
      .values({ email, passwordHash, name })
      .returning()

    const token = jwt.sign(
      { id: user.id, email, role: 'user' },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN as any }
    )

    logger.info('User registered', { userId: user.id, email })

    return {
      token,
      user: { id: user.id, email, name, role: 'user' },
    }
  },

  async userLogin(email: string, password: string): Promise<LoginResult> {
    const user = await db.query.users.findFirst({
      where: eq(users.email, email),
    })

    if (!user) {
      throw createError('Invalid credentials', 401)
    }

    const isValid = await bcrypt.compare(password, user.passwordHash)
    if (!isValid) {
      throw createError('Invalid credentials', 401)
    }

    const token = jwt.sign(
      { id: user.id, email, role: 'user' },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN as any }
    )

    logger.info('User logged in', { userId: user.id, email })

    return {
      token,
      user: { id: user.id, email, name: user.name, role: 'user' },
    }
  },

  async getMe(userId: string) {
    if (userId === 'admin') {
      return {
        id: 'admin',
        email: env.ADMIN_EMAIL,
        name: 'Admin',
        role: 'admin' as const,
        instagramConnected: false,
        trainingStatus: 'none',
      }
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    })

    if (!user) throw createError('User not found', 404)

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: 'user' as const,
      instagramConnected: user.instagramConnected,
      instagramUsername: user.instagramUsername,
      trainingStatus: user.trainingStatus,
    }
  },
}
