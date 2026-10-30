/**
 * Pure decision helpers for confirmation-depth publishing (issue #706).
 *
 * These are deliberately free of any polkadot/config/network imports so the
 * core logic — "is this transaction durably published?" and "should this
 * failure evict the signing account?" — can be unit-tested in isolation.
 */

/**
 * A transaction is considered durably published once `depth` additional blocks
 * have been built on top of its inclusion block, i.e. the chain head has
 * reached `inclusionNumber + depth`.
 */
export const hasReachedConfirmationDepth = (
  headNumber: number,
  inclusionNumber: number,
  depth: number,
): boolean => headNumber >= inclusionNumber + depth

/**
 * The inclusion block is still canonical iff the chain's block hash at the
 * inclusion height is unchanged. If it differs, a reorg replaced the block and
 * the transaction is no longer on-chain.
 */
export const isStillCanonical = (
  canonicalHashAtInclusionHeight: string,
  inclusionHash: string,
): boolean => canonicalHashAtInclusionHeight === inclusionHash

/**
 * Only a genuinely `Invalid` transaction implicates the signing account itself
 * (unusable key / bad cryptographic state), so it is the sole failure that evicts
 * the account from the pool permanently. Balance/fee rejections (Substrate error 1010
 * / Inability to pay fees) are classified as `InsufficientFunds` and handled via the
 * account manager's cooldown and rerouting mechanism rather than eviction. Every
 * other failure — reorg, timeout, usurped, RPC/subscription/API blips, submission
 * errors — is a chain or infrastructure event: the account is healthy and must be
 * kept (its nonce is resynced) so transient incidents cannot drain the signer pool
 * (issues #706, #879).
 */
export const isAccountFault = (status?: string): boolean => status === 'Invalid'

/**
 * Detects whether a transaction submission error is caused by insufficient funds /
 * fee payment failure (Substrate RPC error 1010 / "Inability to pay some fees").
 *
 * Checks structured error code first if present, falling back to message text.
 */
export const isInsufficientFundsError = (error: unknown): boolean => {
  if (!error) return false
  if (typeof error === 'object') {
    const err = error as { code?: number | string; message?: string }
    if (err.code === 1010 || err.code === '1010') return true
    if (typeof err.message === 'string') {
      const msg = err.message.toLowerCase()
      return (
        msg.includes('1010') ||
        msg.includes('inability to pay some fees') ||
        msg.includes('insufficient funds') ||
        msg.includes('insufficient balance')
      )
    }
  }
  return false
}
