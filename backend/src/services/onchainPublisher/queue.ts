import { ApiPromise } from '@polkadot/api'
import { KeyringPair } from '@polkadot/keyring/types'
import {
  Queue,
  Transaction,
  TransactionStatus,
} from '../../models/objects/index.js'
import { getOnChainNonce } from '../../utils/networkApi.js'
import { getAccount, getAccounts } from './accounts.js'

export const queue: Queue = {
  api: null,
  transactions: [],
  updatePeriod: 15_000,
  transactionRetryPeriod: 30_000,
  transactionRetryLimit: 1,
}

export const getAvailableAccount = (): KeyringPair => {
  if (!queue.api) {
    throw new Error('Queue not initialized')
  }

  const accounts = getAccounts()

  const account = accounts.reduce(
    (accountWithMinimumQueuedTrxs, account) =>
      queue.transactions.filter(
        (tx) => tx.account === accountWithMinimumQueuedTrxs.address,
      ).length >
      queue.transactions.filter((tx) => tx.account === account.address).length
        ? account
        : accountWithMinimumQueuedTrxs,
    accounts[0],
  )

  return account
}

const internalAccountNonce = (account: KeyringPair): number | undefined => {
  const nonce = queue.transactions
    .filter((tx) => tx.account === account.address)
    .sort((a, b) => b.nonce - a.nonce)
    .map((tx) => tx.nonce)[0]

  return nonce ? nonce + 1 : undefined
}

export const getAccountNonce = async (
  api: ApiPromise,
  address: string,
): Promise<number> => {
  if (!queue.api) {
    throw new Error('Queue not initialized')
  }
  const account = getAccount(address)

  if (!account) {
    throw new Error('Account not found')
  }

  const internalNonce = internalAccountNonce(account)

  if (internalNonce) {
    return internalNonce
  }

  const nonce = await getOnChainNonce(api, address)
  return nonce
}

export const addTransaction = (
  transaction: Transaction,
  nonce: number,
  account: KeyringPair,
) => {
  if (!queue.api) {
    throw new Error('Queue not initialized')
  }

  queue.transactions.push({
    transaction,
    nonce,
    account: account.address,
    status: TransactionStatus.PENDING,
    sentAt: Date.now(),
    retries: queue.transactionRetryLimit,
  })
}

const drainQueue = async () => {
  if (!queue.api) {
    throw new Error('Queue not initialized')
  }

  for (const account of getAccounts()) {
    const nonce = await getOnChainNonce(queue.api, account.address)
    queue.transactions = queue.transactions.filter(
      (tx) => tx.account !== account.address || tx.nonce > nonce,
    )
  }

  console.log(
    `Queue drained there are ${queue.transactions.length} transactions left`,
  )
}

const retryTransactions = () => {
  if (queue.api === null) {
    throw new Error('Queue not initialized')
  }

  let transactionsToRetry = queue.transactions.filter(
    (tx) => Date.now() - tx.sentAt > queue.transactionRetryPeriod,
  )

  queue.transactions = queue.transactions.filter(
    (tx) => !transactionsToRetry.includes(tx) || tx.retries > 0,
  )

  console.log(`Retrying ${transactionsToRetry.length} transactions`)

  transactionsToRetry = transactionsToRetry.filter((tx) => tx.retries > 0)
  transactionsToRetry.forEach(async (tx) => {
    if (!queue.api) {
      console.error('Queue not initialized')
      return
    }

    const rebuiltTransaction = queue.api.tx[tx.transaction.module][
      tx.transaction.method
    ](...tx.transaction.params)

    const account = getAccount(tx.account)
    if (!account) {
      console.error('Account not found')
      return
    }

    await rebuiltTransaction.signAndSend(account, {
      nonce: tx.nonce,
    })

    queue.transactions = queue.transactions.map((t) =>
      t.account === tx.account && t.nonce === tx.nonce
        ? {
            ...t,
            status: TransactionStatus.PENDING,
            sentAt: Date.now(),
            retries: tx.retries - 1,
          }
        : t,
    )
  })
}

export const updateQueue = async () => {
  if (!queue.api) {
    throw new Error('Queue not initialized')
  }

  await drainQueue()
  retryTransactions()

  setTimeout(updateQueue, queue.updatePeriod)
}

export const initializeQueue = (api: ApiPromise) => {
  queue.api = api

  setTimeout(updateQueue, queue.updatePeriod)
}

export const registerTransactionInQueue = async (
  transaction: Transaction,
): Promise<{
  account: KeyringPair
  nonce: number
}> => {
  if (!queue.api) {
    throw new Error('Queue not initialized')
  }

  const account = getAvailableAccount()
  const nonce = await getAccountNonce(queue.api, account.address)

  addTransaction(transaction, nonce, account)

  return {
    account,
    nonce,
  }
}
