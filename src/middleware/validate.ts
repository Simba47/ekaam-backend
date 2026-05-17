import { Request, Response, NextFunction } from 'express'
import { ZodSchema, ZodError } from 'zod'

export const validate =
  (schema: ZodSchema, target: 'body' | 'query' | 'params' = 'body') =>
  (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target])

    if (!result.success) {
      const errors = (result.error as ZodError).flatten().fieldErrors
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors,
      })
      return
    }

    req[target] = result.data
    next()
  }
