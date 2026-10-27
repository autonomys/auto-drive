import { getDatabase } from '../drivers/pg.js'
import { createLogger } from '../drivers/logger.js'

const logger = createLogger('repositories:walletNonces')

const createNonce = async (nonce: string, expiresAt: Date) => {
  const db = await getDatabase()

  // Pruning is housekeeping, so a failure must not block sign-in
  await db
    .query({
      text: `DELETE FROM users.wallet_nonces WHERE nonce IN (
        SELECT nonce FROM users.wallet_nonces WHERE expires_at < NOW() LIMIT 1000
      )`,
    })
    .catch((error) => logger.warn('Failed to prune wallet nonces', error))
  await db.query({
    text: 'INSERT INTO users.wallet_nonces (nonce, expires_at) VALUES ($1, $2)',
    values: [nonce, expiresAt],
  })
}

// Deleting the row is what makes a nonce single-use
const consumeNonce = async (nonce: string): Promise<boolean> => {
  const db = await getDatabase()

  const result = await db.query({
    text: 'DELETE FROM users.wallet_nonces WHERE nonce = $1 AND expires_at > NOW()',
    values: [nonce],
  })

  return result.rowCount === 1
}

export const walletNoncesRepository = {
  createNonce,
  consumeNonce,
}
