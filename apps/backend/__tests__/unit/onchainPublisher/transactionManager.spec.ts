import { afterEach, describe, expect, it, jest } from '@jest/globals'
import type { ApiPromise } from '@polkadot/api'
import type { SubmittableExtrinsic } from '@polkadot/api/types'
import type { KeyringPair } from '@polkadot/keyring/types'
import { submitTransaction } from '../../../src/infrastructure/services/upload/onchainPublisher/transactionManager.js'
import { config } from '../../../src/config.js'

/**
 * Unit tests for the confirmation watch in `submitTransaction`, focused on the
 * poll fallback that cures the "stuck in publishing" incident: confirmation
 * must still complete when the new-heads subscription goes silent (e.g. after a
 * WebSocket reconnect), and a subscription that fails to open must no longer
 * fail the transaction. The polkadot `api` and the extrinsic are mocked; fake
 * timers drive the poll interval deterministically.
 */

const TX_HASH = '0xtx'
const INCLUSION_HASH = '0xincl'
const INCLUSION_NUMBER = 100
const REORG_HASH = '0xreorg'
const KEYPAIR = {} as unknown as KeyringPair

// A head high enough that the confirmation depth is reached in a single check.
const HEAD_AT_DEPTH = INCLUSION_NUMBER + config.chain.confirmationDepth

type HeadHandler = (header: { number: { toNumber: () => number } }) => unknown
type SubscribeImpl = (cb: HeadHandler) => Promise<() => void>

const makeApi = (opts: {
  subscribe: SubscribeImpl
  headNumber: number
  canonicalHash?: string
}) => {
  const { subscribe, headNumber, canonicalHash = INCLUSION_HASH } = opts
  return {
    once: jest.fn(),
    off: jest.fn(),
    registry: { findMetaError: () => ({ section: 'x', name: 'y', docs: ['z'] }) },
    rpc: {
      chain: {
        // Resolves the inclusion block number for the hash reported by isInBlock.
        getBlock: jest.fn(async () => ({
          block: { header: { number: { toNumber: () => INCLUSION_NUMBER } } },
        })),
        subscribeNewHeads: jest.fn(subscribe),
        // The poll fallback's head source — a fresh request each tick.
        getHeader: jest.fn(async () => ({
          number: { toNumber: () => headNumber },
        })),
        // Canonical block hash at the inclusion height (== inclusion hash unless
        // a reorg is being simulated).
        getBlockHash: jest.fn(async () => ({ toString: () => canonicalHash })),
      },
    },
  }
}

const makeTransaction = () => {
  let statusCb: ((result: unknown) => unknown) | undefined
  const signAndSend = jest.fn(
    (_keyPair: unknown, _opts: unknown, cb: (result: unknown) => unknown) => {
      statusCb = cb
      return Promise.resolve(() => {})
    },
  )
  const tx = { hash: { toString: () => TX_HASH }, signAndSend }
  // Simulate the extrinsic reaching a block (inclusion).
  const triggerInBlock = () => {
    if (!statusCb) throw new Error('signAndSend was not called')
    return statusCb({
      status: {
        isInBlock: true,
        isInvalid: false,
        isUsurped: false,
        type: 'InBlock',
        asInBlock: { toString: () => INCLUSION_HASH },
      },
    })
  }
  return { tx, triggerInBlock }
}

const run = (api: ReturnType<typeof makeApi>, tx: ReturnType<typeof makeTransaction>['tx']) =>
  submitTransaction(
    api as unknown as ApiPromise,
    KEYPAIR,
    tx as unknown as SubmittableExtrinsic<'promise'>,
    0,
  )

describe('submitTransaction — confirmation watch', () => {
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('confirms via the poll fallback when the subscription never delivers a head', async () => {
    jest.useFakeTimers()
    // Silent subscription: returns an unsub but never invokes the callback,
    // simulating a WS subscription that went dead after a reconnect.
    const api = makeApi({
      subscribe: async () => () => {},
      headNumber: HEAD_AT_DEPTH,
    })
    const { tx, triggerInBlock } = makeTransaction()

    const result = run(api, tx)
    await triggerInBlock()

    // No head is ever pushed; only the poll can move this forward.
    await jest.advanceTimersByTimeAsync(config.chain.confirmationPollIntervalMs * 2)

    await expect(result).resolves.toMatchObject({
      success: true,
      status: 'InBlock',
      blockNumber: INCLUSION_NUMBER,
      blockHash: INCLUSION_HASH,
    })
    expect(api.rpc.chain.getHeader).toHaveBeenCalled()

    // The poll interval is torn down on resolution: further time does not poll.
    const polls = api.rpc.chain.getHeader.mock.calls.length
    await jest.advanceTimersByTimeAsync(config.chain.confirmationPollIntervalMs * 3)
    expect(api.rpc.chain.getHeader.mock.calls.length).toBe(polls)
  })

  it('does not fail the tx when the subscription cannot be opened — the poll still confirms', async () => {
    jest.useFakeTimers()
    // subscribeNewHeads rejects. Before the fix this resolved ConfirmationError
    // immediately (→ nonce resync → same-nonce retry, a step in the incident
    // loop); now the poll fallback carries the tx to confirmation.
    const api = makeApi({
      subscribe: async () => {
        throw new Error('subscription failed to open')
      },
      headNumber: HEAD_AT_DEPTH,
    })
    const { tx, triggerInBlock } = makeTransaction()

    const result = run(api, tx)
    await triggerInBlock()
    await jest.advanceTimersByTimeAsync(config.chain.confirmationPollIntervalMs * 2)

    await expect(result).resolves.toMatchObject({ success: true, status: 'InBlock' })
  })

  it('still confirms via the new-heads subscription (primary path unchanged)', async () => {
    jest.useFakeTimers()
    let headCb: HeadHandler | undefined
    const api = makeApi({
      subscribe: async (cb) => {
        headCb = cb
        return () => {}
      },
      headNumber: 0, // getHeader is unused on the subscription path
    })
    const { tx, triggerInBlock } = makeTransaction()

    const result = run(api, tx)
    await triggerInBlock()

    // Push a head at confirmation depth through the subscription — no poll tick.
    await headCb!({ number: { toNumber: () => HEAD_AT_DEPTH } })

    await expect(result).resolves.toMatchObject({
      success: true,
      status: 'InBlock',
      blockNumber: INCLUSION_NUMBER,
    })
    expect(api.rpc.chain.getHeader).not.toHaveBeenCalled()
  })

  it('resolves Reorged when the inclusion block is no longer canonical at depth', async () => {
    jest.useFakeTimers()
    const api = makeApi({
      subscribe: async () => () => {},
      headNumber: HEAD_AT_DEPTH,
      canonicalHash: REORG_HASH, // chain reports a different block at the height
    })
    const { tx, triggerInBlock } = makeTransaction()

    const result = run(api, tx)
    await triggerInBlock()
    await jest.advanceTimersByTimeAsync(config.chain.confirmationPollIntervalMs * 2)

    await expect(result).resolves.toMatchObject({
      success: false,
      status: 'Reorged',
    })
  })
})
