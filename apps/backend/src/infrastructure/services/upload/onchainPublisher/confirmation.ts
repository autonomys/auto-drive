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
 * (unusable key / insufficient balance), so it is the sole failure that evicts
 * the account from the pool. Every other failure — reorg, timeout, usurped,
 * RPC/subscription/API blips, submission errors — is a chain or infrastructure
 * event: the account is healthy and must be kept (its nonce is resynced) so a
 * transient incident cannot drain the signer pool (issue #706).
 */
export const isAccountFault = (status?: string): boolean => status === 'Invalid'
