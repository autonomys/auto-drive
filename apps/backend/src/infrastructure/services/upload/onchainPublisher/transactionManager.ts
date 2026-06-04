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
    // Guards against handling block inclusion more than once (the extrinsic
    // subscription stays open and keeps emitting later statuses).
    let confirmationStarted = false
    // Guards against re-entrant confirmation checks while the async canonical
    // hash lookup is in flight.
    let confirmationChecking = false

    const cleanup = () => {
      clearTimeout(timeout)
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

    const timeout = setTimeout(() => {
      logger.error(`Transaction timed out. Tx hash: ${txHash}`)
      rejectOnce(new Error('Transaction timeout'))
    }, config.chain.transactionTimeoutMs)

    const onApiError = (error: Error) => {
      rejectOnce(error)
    }

    api.once('error', onApiError)

    /**
     * Waits until `confirmationDepth` blocks build on the inclusion block, then
     * confirms it is still canonical before resolving.
     */
    const awaitConfirmation = async (
      inclusionHash: string,
      inclusionNumber: number,
    ) => {
      const targetNumber = inclusionNumber + config.chain.confirmationDepth
      logger.info(
        'Tx %s in block %d (%s) — awaiting %d confirmations',
        txHash,
        inclusionNumber,
        inclusionHash,
        config.chain.confirmationDepth,
      )

      try {
        headsUnsub = await api.rpc.chain.subscribeNewHeads(async (header) => {
          if (isResolved || confirmationChecking) return
          if (header.number.toNumber() < targetNumber) return

          confirmationChecking = true
          try {
            // The block is now buried deep enough. Verify the inclusion block
            // is still the canonical block at its height — if a reorg replaced
            // it, our transaction is no longer on-chain.
            const canonicalHash = (
              await api.rpc.chain.getBlockHash(inclusionNumber)
            ).toString()

            if (canonicalHash === inclusionHash) {
              resolveOnce({
                success: true,
                txHash,
                blockHash: inclusionHash,
                blockNumber: inclusionNumber,
                status: 'InBlock',
              })
            } else {
              logger.warn(
                'Tx %s reorged out: inclusion block %d (%s) replaced by %s',
                txHash,
                inclusionNumber,
                inclusionHash,
                canonicalHash,
              )
              resolveOnce({
                success: false,
                txHash,
                status: 'Reorged',
                error: 'Inclusion block reorged out before confirmation',
              })
            }
          } finally {
            confirmationChecking = false
          }
        })
      } catch (error) {
        onApiError(error as Error)
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
            if (confirmationStarted) return
            confirmationStarted = true

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

            try {
              const inclusionHash = status.asInBlock.toString()
              const { block } = await api.rpc.chain.getBlock(inclusionHash)
              await awaitConfirmation(
                inclusionHash,
                block.header.number.toNumber(),
              )
            } catch (error) {
              // Route lookup/subscription errors through rejectOnce so the
              // promise settles instead of hanging until the overall timeout.
              rejectOnce(error as Error)
            }
          } else if (status.isInvalid) {
            resolveOnce({
              success: false,
              txHash,
              status: 'Invalid',
              error: 'Transaction invalid',
            })
          } else if (status.isUsurped) {
            rejectOnce(new Error(`Transaction ${status.type}`))
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
                try {
                  if (result.status === 'Reorged') {
                    // A reorg is a chain event, not an account fault. Keep the
                    // account in the pool and just resync its nonce, which the
                    // dropped transaction left ahead of on-chain state.
                    await accountManager.resyncAccount(account.address)
                  } else {
                    await accountManager.removeAccount(account.address)
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
