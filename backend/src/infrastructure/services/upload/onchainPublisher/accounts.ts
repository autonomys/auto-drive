import { ApiPromise, Keyring } from '@polkadot/api'
import { config } from '../../../../config.js'
import { getOnChainNonce } from '../../../../shared/utils/networkApi.js'
import pLimit from 'p-limit'

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

  const uniqueExec = pLimit(1)
  const nonceByAccount: Record<string, number> = {}
  let trxCounter = 0

  const initAccounts = () =>
    uniqueExec(async () => {
      accounts = getAccounts()
      const promises = accounts.map(async (account) => {
        const nonce = await getOnChainNonce(api, account.address)
        nonceByAccount[account.address] = nonce
      })

      await Promise.all(promises)
    })

  const getNextAccount = () => {
    const account = accounts[trxCounter % accounts.length]
    trxCounter++
    return account
  }

  const registerTransaction = () =>
    uniqueExec(() => {
      const account = getNextAccount()
      const nonce = nonceByAccount[account.address]
      nonceByAccount[account.address] = nonce + 1
      return { account, nonce }
    })

  const removeAccount = (address: string) => {
    const index = accounts.findIndex((account) => account.address === address)
    if (index !== -1) {
      accounts.splice(index, 1)
    }

    if (accounts.length === 0) {
      return initAccounts()
    }
  }

  await initAccounts()

  return { registerTransaction, removeAccount }
}
