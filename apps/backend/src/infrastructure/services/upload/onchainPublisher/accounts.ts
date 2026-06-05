import { ApiPromise, Keyring } from '@polkadot/api'
import { config } from '../../../../config.js'
import { getOnChainNonce } from '../../../../shared/utils/networkApi.js'
import { createLogger } from '../../../drivers/logger.js'
import pLimit from 'p-limit'

const logger = createLogger('upload:accountManager')

export const getAccounts = () => {
  const privateKeys = config.chain.privateKeysPath
  const privateKeysArray = privateKeys
    .split(',')
    .map((key) => key.trim())
    .filter((e) => e.length > 0)

  const keyring = new Keyring({
    type: 'sr25519',
  })

  privateKeysArray.forEach((key) => keyring.addFromUri(key))

  return keyring.getPairs()
}

export const getAccount = (address: string) => {
  const accounts = getAccounts()
  return accounts.find((account) => account.address === address)
}

export const createAccountManager = async (api: ApiPromise) => {
  let accounts = getAccounts()

  // All three operations — initAccounts, registerTransaction, and
  // removeAccount — are serialized through this single limiter.
  // This eliminates the race condition where concurrent removeAccount
  // calls could drain the pool while registerTransaction reads it.
  const uniqueExec = pLimit(1)
  const nonceByAccount: Record<string, number> = {}
  let trxCounter = 0

  const initAccounts = async () => {
    // Fetch fresh accounts but only swap them in after all nonces
    // are successfully retrieved. This avoids a partially-initialized
    // state if getOnChainNonce fails for some accounts mid-reinit.
    const freshAccounts = getAccounts()
    logger.info('Initializing %d accounts', freshAccounts.length)

    const promises = freshAccounts.map(async (account) => {
      const nonce = await getOnChainNonce(api, account.address)
      nonceByAccount[account.address] = nonce
    })

    await Promise.all(promises)
    accounts = freshAccounts // atomic swap only on success
  }

  const registerTransaction = () =>
    uniqueExec(async () => {
      if (accounts.length === 0) {
        logger.warn(
          'No accounts available, reinitializing before registration',
        )
        await initAccounts()
      }

      if (accounts.length === 0) {
        throw new Error(
          'No publishing accounts available after reinitialization',
        )
      }

      const account = accounts[trxCounter % accounts.length]
      trxCounter++
      const nonce = nonceByAccount[account.address]
      nonceByAccount[account.address] = nonce + 1
      return { account, nonce }
    })

  const removeAccount = (address: string) =>
    uniqueExec(async () => {
      const index = accounts.findIndex(
        (account) => account.address === address,
      )
      if (index !== -1) {
        accounts.splice(index, 1)
        logger.warn(
          'Removed account %s from pool (%d remaining)',
          address,
          accounts.length,
        )
      }

      if (accounts.length === 0) {
        logger.warn('All accounts removed, reinitializing')
        await initAccounts()
      }
    })

  // Resync an account's nonce from chain without removing it from the pool.
  // Used when a transaction is dropped by a chain reorg: the in-memory nonce
  // counter has already advanced past the dropped transaction, but the
  // on-chain nonce did not move (the transaction was never canonical). Keeping
  // the account in the pool — rather than removing it — avoids draining the
  // signer pool during the very reorgs this manager is meant to survive.
  const resyncAccount = (address: string) =>
    uniqueExec(async () => {
      // Re-add the account if a prior failure had removed it from the pool.
      if (!accounts.some((account) => account.address === address)) {
        const account = getAccount(address)
        if (account) {
          accounts.push(account)
        }
      }

      const nonce = await getOnChainNonce(api, address)
      nonceByAccount[address] = nonce
      logger.info('Resynced account %s to on-chain nonce %d', address, nonce)
    })

  await uniqueExec(() => initAccounts())

  return { registerTransaction, removeAccount, resyncAccount }
}
