import { Router } from 'express'
import { asyncSafeHandler } from '../../shared/utils/express.js'
import { IntentsUseCases } from '../../core/users/intents.js'
import { handleInternalError } from '../../shared/utils/neverthrow.js'
import { handleError } from '../../errors/index.js'

/**
 * Public storage price endpoint.
 *
 * Returns the current cost of storage in shannons-per-byte.
 * No authentication or feature-flag gating required.
 *
 * Security:
 *  - Response is served from a 60 s in-memory cache (see IntentsUseCases)
 *  - Only GET is exposed; POST/PUT/DELETE are not registered
 *  - Nginx restricts the public domain to this specific path
 */
export const priceController = Router()

priceController.get(
  '/',
  asyncSafeHandler(async (_req, res) => {
    const result = await handleInternalError(
      IntentsUseCases.getPrice(),
      'Failed to get price',
    )
    if (result.isErr()) {
      handleError(result.error, res)
      return
    }

    // Allow CDN / browser caching for 30 s to further reduce load
    res.set('Cache-Control', 'public, max-age=30')
    res.status(200).json(result.value)
  }),
)
