import type { KeyringPair } from '@polkadot/keyring/types'
import { config } from '../../../../config.js'
import { getOnChainNonce } from '../../../../shared/utils/networkApi.js'
import { ApiPromise, Keyring } from '../../../../shared/utils/polkadot.js'
import { createLogger } from '../../../drivers/logger.js'
import { slackNotifier } from '../../slack/index.js'
import pLimit from 'p-limit'

const logger = createLogger('upload:accountManager')

export class NoFundedSignerError extends Error {
  constructor(message = 'No funded signer accounts available') {
    super(message)
    this.name = 'NoFundedSignerError'
  }
}

export type AccountState = {
  pair: KeyringPair
  nonce: number
  unfundedUntil?: number // epoch ms; excluded from selection while set and in the future
  lastKnownFree?: bigint
}

type AccountInfoLike = {
  data?: {
    free?: {
      toString(): string
    }
  }
}

const ALERT_RATE_LIMIT_MS = 15 * 60 * 1000 // 15 minutes

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

export const createAccountManager = async (
  api: ApiPromise,
  accountsProvider: () => KeyringPair[] = getAccounts,
) => {
  const accountStates: Map<string, AccountState> = new Map()

  // All account operations are serialized through this single limiter
  // to avoid race conditions with concurrent registrations, removals, and reroutes.
  const uniqueExec = pLimit(1)
  let trxCounter = 0
  let lastAllUnfundedAlertTime = 0
  let lastLowBalanceAlertTime = 0

  const sendAllUnfundedAlert = async () => {
    const now = Date.now()
    if (now - lastAllUnfundedAlertTime < ALERT_RATE_LIMIT_MS) {
      return
    }
    lastAllUnfundedAlertTime = now

    const details = Array.from(accountStates.entries())
      .map(
        ([addr, state]) =>
          `• ${addr}: ${state.lastKnownFree !== undefined ? state.lastKnownFree.toString() : 'unknown'} shannons`,
      )
      .join('\n')

    const title = `All ${accountStates.size} publisher wallets below MIN_SIGNER_BALANCE — publishing paused`
    logger.warn(title, { details })
    await slackNotifier.send({ title, details })
  }

  const sendLowBalanceAlert = async (
    lowWallets: Array<{ address: string; free: bigint }>,
  ) => {
    const now = Date.now()
    if (now - lastLowBalanceAlertTime < ALERT_RATE_LIMIT_MS) {
      return
    }
    lastLowBalanceAlertTime = now

    const details = lowWallets
      .map(
        (w) =>
          `• ${w.address}: ${w.free.toString()} shannons (< ${config.chain.lowSignerBalanceWarn.toString()})`,
      )
      .join('\n')

    const title = `Warning: ${lowWallets.length} publisher wallet(s) below LOW_SIGNER_BALANCE_WARN`
    logger.warn(title, { details })
    await slackNotifier.send({ title, details })
  }

  const initAccounts = async () => {
    const freshAccounts = accountsProvider()
    logger.info('Initializing %d accounts', freshAccounts.length)

    const promises = freshAccounts.map(async (account) => {
      const nonce = await getOnChainNonce(api, account.address)
      let freeBalance: bigint | undefined
      if (api.query?.system?.account) {
        try {
          const accountInfo = (await api.query.system.account(
            account.address,
          )) as unknown as AccountInfoLike
          if (accountInfo?.data?.free) {
            freeBalance = BigInt(accountInfo.data.free.toString())
          }
        } catch (err) {
          logger.warn(
            err as Error,
            'Failed to fetch initial balance for %s',
            account.address,
          )
        }
      }
      return { account, nonce, freeBalance }
    })

    const results = await Promise.all(promises)
    const now = Date.now()

    for (const { account, nonce, freeBalance } of results) {
      const existing = accountStates.get(account.address)
      let unfundedUntil = existing?.unfundedUntil

      // If initial balance is known to be below minSignerBalance, start cooldown
      if (
        unfundedUntil === undefined &&
        freeBalance !== undefined &&
        freeBalance < config.chain.minSignerBalance
      ) {
        unfundedUntil = now + config.chain.unfundedCooldownMs
        logger.warn(
          'Signer account %s initial balance (%s) is below minimum (%s) — marked unfunded for %dms',
          account.address,
          freeBalance.toString(),
          config.chain.minSignerBalance.toString(),
          config.chain.unfundedCooldownMs,
        )
      }

      accountStates.set(account.address, {
        pair: account,
        nonce,
        unfundedUntil,
        lastKnownFree: freeBalance,
      })
    }
  }

  const registerTransaction = async () => {
    let hasExpiredCooldown = false
    try {
      return await uniqueExec(async () => {
        if (accountStates.size === 0) {
          logger.warn(
            'No accounts available, reinitializing before registration',
          )
          await initAccounts()
        }

        const now = Date.now()

        const canQueryBalances =
          Boolean(api.query?.system?.account) &&
          config.chain.signerBalanceCheckIntervalMs > 0

        // If any accounts have expired cooldowns, only re-admit immediately if balance reads
        // aren't supported. Otherwise, trigger refreshBalances outside the lock and leave the
        // wallet excluded until its balance is confirmed >= minSignerBalance.
        for (const state of accountStates.values()) {
          if (state.unfundedUntil !== undefined && state.unfundedUntil <= now) {
            if (!canQueryBalances) {
              state.unfundedUntil = undefined
            } else {
              hasExpiredCooldown = true
            }
          }
        }

        const eligible = Array.from(accountStates.values()).filter(
          (s) => s.unfundedUntil === undefined,
        )

        if (eligible.length === 0) {
          // Fire alert asynchronously without holding the uniqueExec lock
          void sendAllUnfundedAlert().catch((err) =>
            logger.error(err as Error, 'Failed to send all-unfunded alert'),
          )
          throw new NoFundedSignerError(
            `All ${accountStates.size} publisher wallets are unfunded (< ${config.chain.minSignerBalance.toString()} shannons) — publishing paused`,
          )
        }

        const selected = eligible[trxCounter % eligible.length]
        trxCounter++
        const nonce = selected.nonce
        selected.nonce = nonce + 1
        return { account: selected.pair, nonce }
      })
    } finally {
      if (hasExpiredCooldown) {
        void refreshBalances().catch((err) =>
          logger.error(
            err as Error,
            'Failed to refresh balances on cooldown expiry',
          ),
        )
      }
    }
  }

  const markUnfunded = (address: string) =>
    uniqueExec(async () => {
      const state = accountStates.get(address)
      if (!state) return

      const now = Date.now()
      const wasUnfunded =
        state.unfundedUntil !== undefined && state.unfundedUntil > now
      state.unfundedUntil = now + config.chain.unfundedCooldownMs

      if (!wasUnfunded) {
        logger.warn(
          'Marked account %s as unfunded (cooldown until %s)',
          address,
          new Date(state.unfundedUntil).toISOString(),
        )
      }

      // Resync nonce from chain because fee rejection did not consume nonce on-chain
      try {
        const nonce = await getOnChainNonce(api, address)
        state.nonce = nonce
        logger.info(
          'Resynced account %s to on-chain nonce %d after unfunded mark',
          address,
          nonce,
        )
      } catch (err) {
        logger.warn(
          err as Error,
          'Failed to resync nonce for unfunded account %s',
          address,
        )
      }
    })

  const removeAccount = (address: string) =>
    uniqueExec(async () => {
      accountStates.delete(address)
      logger.warn(
        'Removed account %s from pool (%d remaining)',
        address,
        accountStates.size,
      )

      if (accountStates.size === 0) {
        logger.warn('All accounts removed, reinitializing')
        await initAccounts()
      }
    })

  const resyncAccount = (address: string) =>
    uniqueExec(async () => {
      let state = accountStates.get(address)
      if (!state) {
        const fresh = accountsProvider()
        const pair = fresh.find((a) => a.address === address)
        if (pair) {
          state = { pair, nonce: 0 }
          accountStates.set(address, state)
        }
      }

      if (state) {
        const nonce = await getOnChainNonce(api, address)
        state.nonce = nonce
        logger.info('Resynced account %s to on-chain nonce %d', address, nonce)
      }
    })

  const refreshBalances = async () => {
    if (accountStates.size === 0) return
    if (!api.query?.system?.account) return

    const addresses = Array.from(accountStates.keys())
    try {
      const accountInfos = (await (api.query.system.account.multi
        ? api.query.system.account.multi(addresses)
        : Promise.all(
            addresses.map((a) => api.query.system.account(a)),
          ))) as unknown as AccountInfoLike[]

      const now = Date.now()
      const lowBalanceWallets: Array<{ address: string; free: bigint }> = []

      addresses.forEach((address, i) => {
        const state = accountStates.get(address)
        if (!state) return

        const info = accountInfos[i]
        if (!info?.data?.free) return

        const free = BigInt(info.data.free.toString())
        state.lastKnownFree = free

        if (free < config.chain.minSignerBalance) {
          if (state.unfundedUntil === undefined || state.unfundedUntil <= now) {
            state.unfundedUntil = now + config.chain.unfundedCooldownMs
            logger.warn(
              'Signer wallet %s balance %s below minimum %s — marked unfunded for %dms',
              address,
              free.toString(),
              config.chain.minSignerBalance.toString(),
              config.chain.unfundedCooldownMs,
            )
          }
        } else if (state.unfundedUntil !== undefined) {
          logger.info(
            'Signer wallet %s balance recovered (%s) — re-admitting',
            address,
            free.toString(),
          )
          state.unfundedUntil = undefined
        }

        if (free < config.chain.lowSignerBalanceWarn) {
          lowBalanceWallets.push({ address, free })
        }
      })

      if (lowBalanceWallets.length > 0) {
        void sendLowBalanceAlert(lowBalanceWallets).catch((err) =>
          logger.error(err as Error, 'Failed to send low-balance alert'),
        )
      }
    } catch (err) {
      logger.warn(err as Error, 'Failed to refresh signer wallet balances')
    }
  }

  let balanceCheckInterval: ReturnType<typeof setInterval> | undefined
  if (config.chain.signerBalanceCheckIntervalMs > 0) {
    balanceCheckInterval = setInterval(() => {
      void refreshBalances()
    }, config.chain.signerBalanceCheckIntervalMs)
    balanceCheckInterval.unref?.()
  }

  const stop = () => {
    if (balanceCheckInterval) {
      clearInterval(balanceCheckInterval)
      balanceCheckInterval = undefined
    }
  }

  await uniqueExec(() => initAccounts())

  return {
    registerTransaction,
    removeAccount,
    resyncAccount,
    markUnfunded,
    refreshBalances,
    getAccountStates: () => new Map(accountStates),
    stop,
  }
}
