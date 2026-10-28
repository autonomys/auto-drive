import { getDatabase } from '../drivers/pg.js'
import { createLogger } from '../drivers/logger.js'

const logger = createLogger('repositories:walletNonces')

// Recording the nonce is what makes it single-use. Returns false if it was
// already recorded.
const markNonceUsed = async (
  nonce: string,
  expiresAt: Date,
): Promise<boolean> => {
  const db = await getDatabase()

  // Pruning is housekeeping, so a failure must not block sign-in
  await db
    .query({
      text: `DELETE FROM users.wallet_nonces WHERE nonce IN (
        SELECT nonce FROM users.wallet_nonces WHERE expires_at < NOW() LIMIT 1000
      )`,
    })
    .catch((error) => logger.warn('Failed to prune wallet nonces', error))

  const result = await db.query({
    text: 'INSERT INTO users.wallet_nonces (nonce, expires_at) VALUES ($1, $2) ON CONFLICT (nonce) DO NOTHING',
    values: [nonce, expiresAt],
  })

  return result.rowCount === 1
}

export const walletNoncesRepository = {
  markNonceUsed,
}
