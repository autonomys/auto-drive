import { ApiPromise } from '@polkadot/api'
import {
  SubmittableExtrinsic,
  SubmittableResultValue,
} from '@polkadot/api/types'
import { KeyringPair } from '@polkadot/keyring/types'
import { waitReady } from '@polkadot/wasm-crypto'
import { createConnection } from '../../../drivers/substrate.js'
import { Transaction, TransactionResult } from '@auto-drive/models'
import { createLogger } from '../../../drivers/logger.js'
import { createAccountManager } from './accounts.js'
import {
  hasReachedConfirmationDepth,
  isAccountFault,
  isStillCanonical,
} from './confirmation.js'
import pLimit from 'p-limit'
import { config } from '../../../../config.js'

const logger = createLogger('upload:transactionManager')

/**
 * Submits a transaction and resolves only once it is durably published.
 *
 * Autonomys uses Nakamoto-style (probabilistic) consensus, so a transaction
 * that reaches `isInBlock` can still be dropped by a chain reorg. Recording
 * such a transaction as published produced the "phantom nodes" in issue #706.
 *
 * To avoid that, once a transaction is included we wait until
 * `config.chain.confirmationDepth` further blocks have been built on top of it
 * and then verify the inclusion block is still canonical (its hash at that
 * height is unchanged). Only then do we resolve `success: true`. If the block
 * was reorged out, we resolve `success: false` so the node re-enters the
 * publishing pipeline instead of being silently lost.
 */
const submitTransaction = (
  api: ApiPromise,
  keyPair: KeyringPair,
  transaction: SubmittableExtrinsic<'promise'>,
  nonce: number,
): Promise<TransactionResult> => {
  return new Promise((resolve, reject) => {
    const txHash = transaction.hash.toString()
    let extrinsicUnsub: (() => void) | undefined
    let headsUnsub: (() => void) | undefined
    let isResolved = false
    // The block the transaction is currently included in. A reorg can retract
    // the first inclusion block and re-include the extrinsic in a different
    // block, which surfaces as a fresh `isInBlock` event — so this is updated on
    // every inclusion, and confirmation is always evaluated against the latest
    // block rather than a stale one.
    let inclusionHash: string | undefined
    let inclusionNumber: number | undefined
    // Ensures only a single new-heads subscription is opened across (re)inclusions.
    let headsSubscribed = false
    // Monotonic counter incremented synchronously on every `isInBlock` event, in
    // the order `signAndSend` delivers them. The `isInBlock` handler is async and
    // is invoked without being awaited, so concurrent `getBlock` lookups for
    // different inclusion blocks can resolve out of order. This sequence lets a
    // resolving lookup detect that a newer inclusion event has since arrived and
    // skip overwriting the (newer) confirmation target with a stale one.
    let inclusionSeq = 0
    // Guards against re-entrant confirmation checks while the async canonical
    // hash lookup is in flight.
    let confirmationChecking = false

    let timeoutHandle: ReturnType<typeof setTimeout>

    const cleanup = () => {
      clearTimeout(timeoutHandle)
      // Remove the API error listener to prevent accumulation
      api.off('error', onApiError)
      if (extrinsicUnsub) {
        extrinsicUnsub()
      }
      if (headsUnsub) {
        headsUnsub()
      }
    }

    const resolveOnce = (result: TransactionResult) => {
      if (isResolved) return
      isResolved = true
      cleanup()
      resolve(result)
    }

    const rejectOnce = (error: Error) => {
      if (isResolved) return
      isResolved = true
      cleanup()
      reject(error)
    }

    // (Re)start the timeout clock. The inclusion phase and the confirmation
    // phase each get their own full `transactionTimeoutMs` budget: the clock is
    // armed at submission and re-armed once the transaction reaches a block, so
    // a transaction that is merely included late (mempool congestion) is not
    // marked Timeout while it is on-chain and still accumulating confirmations.
    const armTimeout = () => {
      clearTimeout(timeoutHandle)
      timeoutHandle = setTimeout(() => {
        // A timeout is transient (congestion / not yet confirmed), not an
        // account fault. Resolve as a failure with a distinct status so the
        // caller can resync the account's nonce rather than evict it.
        logger.error(`Transaction timed out. Tx hash: ${txHash}`)
        resolveOnce({
          success: false,
          txHash,
          status: 'Timeout',
          error: 'Transaction confirmation timeout',
        })
      }, config.chain.transactionTimeoutMs)
    }

    armTimeout()

    const onApiError = (error: Error) => {
      rejectOnce(error)
    }

    api.once('error', onApiError)

    /**
     * Opens a single new-heads subscription (idempotent across re-inclusions)
     * that, once `confirmationDepth` blocks have built on the *current*
     * inclusion block, verifies that block is still canonical before resolving.
     * The inclusion target is read live, so a reorg that re-includes the
     * extrinsic in a new block is followed rather than mistaken for a drop.
     */
    const ensureConfirmationWatch = async () => {
      // The promise may already have settled (e.g. the timeout fired) while the
      // preceding getBlock lookup was in flight. If so, cleanup() has already
      // run, so subscribing here would leak a subscription that nothing tears
      // down. Bail out instead.
      if (isResolved || headsSubscribed) return
      headsSubscribed = true

      try {
        const unsub = await api.rpc.chain.subscribeNewHeads(async (header) => {
          if (isResolved || confirmationChecking) return
          // Snapshot the current inclusion target; it can change under us if a
          // reorg re-includes the extrinsic in a new block mid-flight.
          const targetHash = inclusionHash
          const targetNumber = inclusionNumber
          if (targetHash === undefined || targetNumber === undefined) return
          if (
            !hasReachedConfirmationDepth(
              header.number.toNumber(),
              targetNumber,
              config.chain.confirmationDepth,
            )
          )
            return

          confirmationChecking = true
          try {
            // The block is now buried deep enough. Verify the inclusion block
            // is still the canonical block at its height — if a reorg replaced
            // it, our transaction is no longer on-chain.
            const canonicalHash = (
              await api.rpc.chain.getBlockHash(targetNumber)
            ).toString()

            // If the inclusion target changed during the async lookup (the
            // extrinsic was re-included elsewhere), defer to the next head
            // rather than judging against a stale target.
            if (
              inclusionHash !== targetHash ||
              inclusionNumber !== targetNumber
            ) {
              return
            }

            if (isStillCanonical(canonicalHash, targetHash)) {
              resolveOnce({
                success: true,
                txHash,
                blockHash: targetHash,
                blockNumber: targetNumber,
                status: 'InBlock',
              })
            } else {
              logger.warn(
                'Tx %s reorged out: inclusion block %d (%s) replaced by %s',
                txHash,
                targetNumber,
                targetHash,
                canonicalHash,
              )
              resolveOnce({
                success: false,
                txHash,
                status: 'Reorged',
                error: 'Inclusion block reorged out before confirmation',
              })
            }
          } catch (error) {
            // A transient RPC failure during the canonical-hash lookup must not
            // surface as an unhandled rejection. Log and let the next head
            // re-trigger the check; the overall timeout is the backstop.
            logger.warn(
              error as Error,
              'Confirmation check failed for tx %s; retrying on next head',
              txHash,
            )
          } finally {
            confirmationChecking = false
          }
        })

        headsUnsub = unsub
        // The promise may have settled during the subscribe await; if so,
        // cleanup() already ran without this handle, so tear it down now.
        if (isResolved) {
          unsub()
          headsUnsub = undefined
        }
      } catch (error) {
        // Failing to subscribe happens after inclusion (the nonce was already
        // consumed on-chain), so this is transient — resolve with a status that
        // resyncs the account rather than evicting it from the pool.
        resolveOnce({
          success: false,
          txHash,
          status: 'ConfirmationError',
          error: (error as Error).message,
        })
      }
    }

    transaction
      .signAndSend(
        keyPair,
        {
          nonce,
        },
        async (result: SubmittableResultValue) => {
          const { status, dispatchError } = result

          logger.debug('Current status: %s, Tx hash: %s', status.type, txHash)

          if (status.isInBlock) {
            // Inclusion reached (possibly a re-inclusion after a reorg): give
            // the confirmation phase its own full timeout budget, independent of
            // however long inclusion took.
            armTimeout()

            if (dispatchError) {
              let errorMessage
              if (dispatchError.isModule) {
                const decoded = api.registry.findMetaError(
                  dispatchError.asModule,
                )
                errorMessage = `${decoded.section}.${decoded.name}: ${decoded.docs}`
              } else {
                errorMessage = dispatchError.toString()
              }
              resolveOnce({
                success: false,
                txHash,
                status: status.type,
                error: errorMessage,
              })
              return
            }

            // Claim this event's place in the inclusion order synchronously,
            // before the async getBlock lookup, so ordering reflects the order
            // `signAndSend` delivered the events rather than the order their
            // lookups happen to resolve.
            const mySeq = ++inclusionSeq

            try {
              // Re-target confirmation at the latest inclusion block. If a reorg
              // re-included the extrinsic elsewhere, this points the canonical
              // check at the new block instead of the retracted one.
              const newInclusionHash = status.asInBlock.toString()
              const { block } = await api.rpc.chain.getBlock(newInclusionHash)
              // A newer `isInBlock` event arrived while this lookup was in
              // flight. Its target is more recent, so don't let this stale
              // lookup clobber it (lookups can resolve out of order).
              if (mySeq !== inclusionSeq) {
                return
              }
              inclusionHash = newInclusionHash
              inclusionNumber = block.header.number.toNumber()
              logger.info(
                'Tx %s in block %d (%s) — awaiting %d confirmations',
                txHash,
                inclusionNumber,
                inclusionHash,
                config.chain.confirmationDepth,
              )
              await ensureConfirmationWatch()
            } catch (error) {
              // A newer inclusion event superseded this one while its lookup was
              // in flight; let that newer event drive confirmation rather than
              // failing the whole transaction on this stale lookup's error.
              if (mySeq !== inclusionSeq) {
                return
              }
              // The transaction is already in a block (nonce consumed on-chain),
              // so a failed lookup here is transient: settle with a status that
              // resyncs the account instead of evicting it, and let the node
              // re-enter publishing rather than hang until the overall timeout.
              resolveOnce({
                success: false,
                txHash,
                status: 'ConfirmationError',
                error: (error as Error).message,
              })
            }
          } else if (status.isInvalid) {
            resolveOnce({
              success: false,
              txHash,
              status: 'Invalid',
              error: 'Transaction invalid',
            })
          } else if (status.isUsurped) {
            // Usurped = replaced by another transaction at the same nonce.
            // Transient and not an account fault; resolve as a failure with a
            // distinct status so the caller resyncs rather than evicts.
            resolveOnce({
              success: false,
              txHash,
              status: 'Usurped',
              error: 'Transaction usurped',
            })
          }
        },
      )
      .then((unsub) => {
        extrinsicUnsub = unsub
        // If we already resolved before signAndSend handed us the unsub
        // handle, tear it down immediately to avoid a leaked subscription.
        if (isResolved) {
          unsub()
        }
      })
      .catch((error) => {
        logger.error(error as Error, 'Error submitting transaction')
        rejectOnce(error)
      })
  })
}

export const createTransactionManager = () => {
  let api: ApiPromise
  let accountManager: Awaited<ReturnType<typeof createAccountManager>>

  const uniqueExecution = pLimit(1)
  const ensureInitialized = () =>
    uniqueExecution(async (): Promise<void> => {
      await waitReady()
      api = api ?? (await createConnection())
      accountManager = accountManager ?? (await createAccountManager(api))
    })

  const pLimitted = pLimit(config.params.maxConcurrentUploads)

  const submit = async (
    transactions: Transaction[],
  ): Promise<TransactionResult[]> => {
    await ensureInitialized()

    const trxPromises = transactions.map(async (transaction) => {
      const { account, nonce } = await accountManager.registerTransaction()
      return { transaction, account, nonce }
    })

    const transactionWithAccount = await Promise.all(trxPromises)

    const promises = transactionWithAccount.map(
      ({ transaction, account, nonce }) => {
        const trx = api.tx[transaction.module][transaction.method](
          ...transaction.params,
        )

        return pLimitted(() =>
          submitTransaction(api, account, trx, nonce)
            .catch((error) => {
              logger.error(error as Error, 'Transaction submission failed')
              return {
                success: false,
                error: error.message,
                status: 'Failed',
              }
            })
            .then(async (result) => {
              if (!result.success) {
                // Only a genuinely Invalid transaction implicates the signing
                // account itself (unusable key / insufficient balance), so it is
                // the sole case that evicts the account from the pool. Every
                // other failure — reorg, timeout, usurped, RPC/subscription/API
                // blips, submission errors — is a chain or infrastructure event:
                // resync the nonce and keep the account, so a transient incident
                // can't drain the signer pool during the congestion/reorgs this
                // change exists to survive.
                try {
                  if (isAccountFault(result.status)) {
                    await accountManager.removeAccount(account.address)
                  } else {
                    await accountManager.resyncAccount(account.address)
                  }
                } catch (recoveryError) {
                  logger.error(
                    recoveryError as Error,
                    'Failed to recover account %s after transaction failure',
                    account.address,
                  )
                }
              }

              return result
            }),
        )
      },
    )

    return Promise.all(promises)
  }

  return {
    submit,
  }
}
