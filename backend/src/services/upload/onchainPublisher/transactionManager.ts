import { ApiPromise } from '@polkadot/api'
import {
  SubmittableExtrinsic,
  SubmittableResultValue,
} from '@polkadot/api/types'
import { KeyringPair } from '@polkadot/keyring/types'
import { waitReady } from '@polkadot/wasm-crypto'
import { createConnection } from '../../../drivers/substrate.js'
import {
  Transaction,
  TransactionResult,
} from '../../../models/objects/index.js'
import { logger } from '../../../drivers/logger.js'
import { createAccountManager } from './accounts.js'
import pLimit from 'p-limit'
import { config } from '../../../config.js'

const submitTransaction = (
  api: ApiPromise,
  keyPair: KeyringPair,
  transaction: SubmittableExtrinsic<'promise'>,
  nonce: number,
): Promise<TransactionResult> => {
  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | undefined
    let isResolved = false

    const timeout = setTimeout(() => {
      if (unsubscribe) {
        unsubscribe()
      }
      if (!isResolved) {
        logger.error(
          `Transaction timed out. Tx hash: ${transaction.hash.toString()}`,
        )
        reject(new Error('Transaction timeout'))
      }
    }, 60_000) // 3 minutes timeout

    const cleanup = () => {
      clearTimeout(timeout)
      if (unsubscribe) {
        unsubscribe()
      }
    }

    api.once('error', (error) => {
      cleanup()
      reject(error)
    })

    transaction
      .signAndSend(
        keyPair,
        {
          nonce,
        },
        async (result: SubmittableResultValue) => {
          const { status, dispatchError } = result

          logger.debug(
            `Current status: ${
              status.type
            }, Tx hash: ${transaction.hash.toString()}`,
          )

          if (status.isInBlock || status.isFinalized) {
            cleanup()
            isResolved = true

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
              resolve({
                success: false,
                txHash: transaction.hash.toString(),
                status: status.type,
                error: errorMessage,
              })
            } else {
              logger.info(`In block: ${status.asInBlock.toString()}`)
              const blockHash = status.asInBlock.toString()
              const { block } = await api.rpc.chain.getBlock(blockHash)
              resolve({
                success: true,
                txHash: transaction.hash.toString(),
                blockHash: status.asInBlock.toString(),
                blockNumber: block.header.number.toNumber(),
                status: status.type,
              })
            }
          } else if (status.isInvalid) {
            cleanup()
            resolve({
              success: false,
              txHash: transaction.hash.toString(),
              status: 'Invalid',
              error: 'Transaction invalid',
            })
          } else if (status.isUsurped) {
            cleanup()
            isResolved = true
            reject(new Error(`Transaction ${status.type}`))
          }
        },
      )
      .then((unsub) => {
        unsubscribe = unsub
      })
      .catch((error) => {
        cleanup()
        reject(error)
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

    const transactionWithAccount = transactions.map((transaction) => {
      const { account, nonce } = accountManager.registerTransaction()
      return { transaction, account, nonce }
    })

    const promises = transactionWithAccount.map(
      ({ transaction, account, nonce }) => {
        const trx = api.tx[transaction.module][transaction.method](
          ...transaction.params,
        )

        return pLimitted(() =>
          submitTransaction(api, account, trx, nonce)
            .catch((error) => {
              logger.error('Transaction submitted failed', error)
              return {
                success: false,
                error: error.message,
                status: 'Failed',
              }
            })
            .then((result) => {
              if (!result.success) {
                accountManager.removeAccount(account.address)
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
