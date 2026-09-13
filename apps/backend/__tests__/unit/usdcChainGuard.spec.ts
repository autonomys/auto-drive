import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { usdcChainGuard } from '../../src/infrastructure/services/paymentManager/usdcChainGuard.js'
import { slackNotifier } from '../../src/infrastructure/services/slack/index.js'
import { config } from '../../src/config.js'

/**
 * The guard exists to make one specific misconfiguration expensive to miss:
 * ETH_CHAIN_ID naming a chain that ETH_CHAIN_ENDPOINT is not.
 *
 * That combination costs a buyer their money and reports nothing on its own.
 * viem takes the watcher's chain from the endpoint, so a Sepolia deployment that
 * left ETH_CHAIN_ID at its mainnet default watches Sepolia perfectly — while the
 * purchase flow, obeying the id it was served, sends approvals and payments to
 * the receiver's address on MAINNET. No credits, and no mispayment row either,
 * because the watcher that would file one is on the other chain.
 *
 * So the assertions here are about ACTING on the verdict, not only reporting it:
 * before this, the check alerted and the deployment kept selling.
 */

// The endpoint, scripted. `_reset` takes the one function that touches the
// network, so no real client is ever built — jest.mock does not hoist over ESM
// imports in this suite, and a spec that quietly POSTed to a real host would be
// slow, flaky and testing viem rather than the guard.
const chainIdResponses: Array<number | Error> = []
const scriptedReader = async () => {
  const next = chainIdResponses.shift()
  if (next === undefined) throw new Error('no stubbed chain id')
  if (next instanceof Error) throw next
  return next
}

describe('usdcChainGuard', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    chainIdResponses.length = 0
    usdcChainGuard._reset(scriptedReader)
    config.ethereum.rpcUrl = 'https://eth.example.org'
    config.ethereum.chainId = 1
    config.ethereum.usdcReceiverAddress =
      '0x1111111111111111111111111111111111111111'
    config.ethereum.usdcTokenAddress =
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    jest.spyOn(slackNotifier, 'send').mockResolvedValue(true)
  })

  it('is not mismatched before anything has been asked', () => {
    // The state that keeps a boot safe. An unrun check must read as "nothing
    // known", never as "wrong" — the alternative fails USDC closed on every
    // restart until an RPC round-trip completes.
    expect(usdcChainGuard.isMismatched()).toBe(false)
    expect(usdcChainGuard.getVerdict()).toEqual({ state: 'unverified' })
  })

  it('records a match and stays open', async () => {
    chainIdResponses.push(1)

    await expect(usdcChainGuard.verify()).resolves.toEqual({
      state: 'match',
      chainId: 1,
    })
    expect(usdcChainGuard.isMismatched()).toBe(false)
    expect(slackNotifier.send).not.toHaveBeenCalled()
  })

  it('fails closed on a verified mismatch, and says which id is which', async () => {
    chainIdResponses.push(11155111)

    await usdcChainGuard.verify()

    expect(usdcChainGuard.isMismatched()).toBe(true)
    expect(slackNotifier.send).toHaveBeenCalledTimes(1)
    // Both ids, because "which one is wrong" — the variable or the endpoint —
    // is the first question, and only the pair answers it.
    const details = (slackNotifier.send as jest.Mock).mock
      .calls[0][0] as unknown as { details: string }
    expect(details.details).toContain('11155111')
    expect(details.details).toContain('1')
  })

  it('does not fail closed when the check cannot run', async () => {
    // An RPC down at boot says nothing about the configuration. Treating it as
    // a mismatch turns an endpoint blip into a payments outage that outlives it.
    chainIdResponses.push(new Error('connect ECONNREFUSED'))

    await expect(usdcChainGuard.verify()).resolves.toEqual({
      state: 'unverified',
    })
    expect(usdcChainGuard.isMismatched()).toBe(false)
    expect(slackNotifier.send).not.toHaveBeenCalled()
  })

  it('retries after a failed read, but never re-reads a settled verdict', async () => {
    // Two halves of the same rule. An `unverified` result is not an answer, so
    // the next caller asks again; a `match` or `mismatch` is final for the life
    // of the process, so a later transient failure cannot un-alert a real
    // mismatch or a later blip re-open a closed path.
    chainIdResponses.push(new Error('connect ECONNREFUSED'), 11155111)

    await usdcChainGuard.verify()
    expect(usdcChainGuard.isMismatched()).toBe(false)

    await usdcChainGuard.verify()
    expect(usdcChainGuard.isMismatched()).toBe(true)

    // A third call must not consume a response — nothing is stubbed, so a read
    // here would throw and leave the verdict unverified.
    await usdcChainGuard.verify()
    expect(usdcChainGuard.isMismatched()).toBe(true)
  })

  it('reads the endpoint once however many callers ask at the same time', async () => {
    // Both the payment manager and the API bootstrap call verify(); the second
    // must not re-POST, and the two must not race to different answers.
    chainIdResponses.push(1)

    const [a, b, c] = await Promise.all([
      usdcChainGuard.verify(),
      usdcChainGuard.verify(),
      usdcChainGuard.verify(),
    ])

    expect([a, b, c]).toEqual([
      { state: 'match', chainId: 1 },
      { state: 'match', chainId: 1 },
      { state: 'match', chainId: 1 },
    ])
    expect(chainIdResponses).toHaveLength(0)
  })

  it('does not ask at all on a deployment that does not sell USDC', async () => {
    config.ethereum.usdcReceiverAddress = undefined

    await expect(usdcChainGuard.verify()).resolves.toEqual({
      state: 'unverified',
    })
    // Nothing consumed: an unconfigured deployment has no chain to be wrong
    // about, and NOT_CONFIGURED already closes the path.
    expect(chainIdResponses).toHaveLength(0)
  })
})
