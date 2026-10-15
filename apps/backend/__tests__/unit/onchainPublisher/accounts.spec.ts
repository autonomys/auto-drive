import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals'
import type { ApiPromise } from '@polkadot/api'
import type { KeyringPair } from '@polkadot/keyring/types'
import {
  createAccountManager,
  NoFundedSignerError,
} from '../../../src/infrastructure/services/upload/onchainPublisher/accounts.js'
import { config } from '../../../src/config.js'
import { slackNotifier } from '../../../src/infrastructure/services/slack/index.js'

describe('createAccountManager — wallet health and cooldown', () => {
  const alice = {
    address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
  } as KeyringPair
  const bob = {
    address: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
  } as KeyringPair
  const charlie = {
    address: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y',
  } as KeyringPair

  let balances: Record<string, bigint>
  let nonces: Record<string, number>
  let slackSendSpy: jest.SpiedFunction<typeof slackNotifier.send>

  beforeEach(() => {
    balances = {
      [alice.address]: 10n * 10n ** 18n, // 10 AI3 (funded)
      [bob.address]: 5n * 10n ** 18n, // 5 AI3 (funded)
      [charlie.address]: 0n, // 0 AI3 (unfunded)
    }
    nonces = {
      [alice.address]: 10,
      [bob.address]: 20,
      [charlie.address]: 30,
    }
    slackSendSpy = jest.spyOn(slackNotifier, 'send').mockResolvedValue(true)
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  const makeMockApi = () => {
    return {
      rpc: {
        system: {
          accountNextIndex: jest.fn(async (addr: string) => ({
            toNumber: () => nonces[addr] ?? 0,
          })),
        },
      },
      query: {
        system: {
          account: jest.fn(async (addr: string) => ({
            data: {
              free: { toString: () => (balances[addr] ?? 0n).toString() },
            },
          })),
          multi: jest.fn(async (addrs: string[]) =>
            addrs.map((addr) => ({
              data: {
                free: { toString: () => (balances[addr] ?? 0n).toString() },
              },
            })),
          ),
        },
      },
    } as unknown as ApiPromise
  }

  it('excludes unfunded wallets on init and round-robins across funded ones only', async () => {
    const api = makeMockApi()
    const manager = await createAccountManager(api, () => [alice, bob, charlie])

    // Charlie has 0 balance (< minSignerBalance of 1 AI3), so Charlie is marked unfunded.
    // Registering should alternate strictly between Alice and Bob.
    const r1 = await manager.registerTransaction()
    expect(r1.account.address).toBe(alice.address)
    expect(r1.nonce).toBe(10)

    const r2 = await manager.registerTransaction()
    expect(r2.account.address).toBe(bob.address)
    expect(r2.nonce).toBe(20)

    const r3 = await manager.registerTransaction()
    expect(r3.account.address).toBe(alice.address)
    expect(r3.nonce).toBe(11)

    manager.stop()
  })

  it('marks an account unfunded upon markUnfunded and resyncs its nonce', async () => {
    const api = makeMockApi()
    const manager = await createAccountManager(api, () => [alice, bob])

    // Initially both are funded.
    const r1 = await manager.registerTransaction()
    expect(r1.account.address).toBe(alice.address)

    // Mark Alice as unfunded (e.g. upon Substrate error 1010)
    await manager.markUnfunded(alice.address)

    // Next registration must skip Alice and return Bob
    const r2 = await manager.registerTransaction()
    expect(r2.account.address).toBe(bob.address)

    // Further registration continues with Bob only
    const r3 = await manager.registerTransaction()
    expect(r3.account.address).toBe(bob.address)

    manager.stop()
  })

  it('re-admits a topped-up wallet after cooldown expires', async () => {
    jest.useFakeTimers()
    const api = makeMockApi()
    const manager = await createAccountManager(api, () => [alice, bob])

    await manager.markUnfunded(alice.address)

    // Fast forward past the cooldown window
    await jest.advanceTimersByTimeAsync(config.chain.unfundedCooldownMs + 100)

    // Alice is topped up
    balances[alice.address] = 20n * 10n ** 18n

    // On registration, cooldown expiry is checked and Alice is re-admitted
    const r1 = await manager.registerTransaction()
    expect(r1.account.address).toBe(alice.address)

    const r2 = await manager.registerTransaction()
    expect(r2.account.address).toBe(bob.address)

    manager.stop()
  })

  it('extends cooldown if wallet is still unfunded when cooldown expires', async () => {
    jest.useFakeTimers()
    const api = makeMockApi()
    const manager = await createAccountManager(api, () => [alice, bob])

    await manager.markUnfunded(alice.address)
    balances[alice.address] = 0n // Still unfunded

    // Advance time past first cooldown
    await jest.advanceTimersByTimeAsync(config.chain.unfundedCooldownMs + 100)

    // Alice is still 0 balance -> Bob selected, Alice cooldown extended
    const r1 = await manager.registerTransaction()
    expect(r1.account.address).toBe(bob.address)

    const states = manager.getAccountStates()
    const aliceState = states.get(alice.address)
    expect(aliceState?.unfundedUntil).toBeGreaterThan(Date.now())

    manager.stop()
  })

  it('throws NoFundedSignerError immediately when all wallets are unfunded and sends Slack alert', async () => {
    const api = makeMockApi()
    balances[alice.address] = 0n
    balances[bob.address] = 0n
    balances[charlie.address] = 0n

    const manager = await createAccountManager(api, () => [alice, bob, charlie])

    await expect(manager.registerTransaction()).rejects.toThrow(
      NoFundedSignerError,
    )
    expect(slackSendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining('publishing paused'),
      }),
    )

    manager.stop()
  })

  it('preserves unfunded status across removeAccount/initAccounts', async () => {
    const api = makeMockApi()
    const manager = await createAccountManager(api, () => [alice, bob])

    await manager.markUnfunded(alice.address)

    // Removing bob empties the pool, triggering reinitialization
    await manager.removeAccount(bob.address)

    // Even after reinitialization, Alice must still be marked unfunded
    const states = manager.getAccountStates()
    expect(states.get(alice.address)?.unfundedUntil).toBeDefined()

    manager.stop()
  })
})
