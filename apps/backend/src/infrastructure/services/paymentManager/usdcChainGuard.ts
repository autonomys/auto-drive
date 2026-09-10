import { createPublicClient, http } from 'viem'
import { config, isUsdcConfigured } from '../../../config.js'
import { createLogger } from '../../drivers/logger.js'
import { slackNotifier } from '../slack/index.js'

const logger = createLogger('PaymentManager:usdcChainGuard')

/**
 * Is `ETH_CHAIN_ENDPOINT` the chain `ETH_CHAIN_ID` says it is?
 *
 * The question is asked because the answer is served to buyers. `GET
 * /payments/usdc/target` reports `ETH_CHAIN_ID` as the chain to switch a wallet
 * to before anything is signed, while viem takes the watcher's chain from the
 * endpoint. Disagree, and a Sepolia deployment that forgot the override watches
 * its own chain perfectly while every buyer approves USDC to the receiver's
 * address on MAINNET: no credits, and no mispayment row either, because the
 * watcher that files those is on the other chain.
 *
 * So the verdict is not only alerted, it is ACTED ON — `getAvailability` closes
 * the path and `getPaymentTarget` returns nothing while a mismatch stands. An
 * alert alone leaves the deployment selling, which is the outcome the check
 * exists to prevent.
 *
 * Three states, and the third is the one that keeps this safe:
 *
 *   - `match`     — verified; nothing to do.
 *   - `mismatch`  — verified WRONG. Fail closed, and escalate once.
 *   - `unverified`— not asked yet, or the read itself failed. Says NOTHING, so
 *                   it must not close the path. An RPC down at boot is an
 *                   outage, not a misconfiguration, and treating the two alike
 *                   turns a blip into a payments outage that outlives it.
 *
 * Lives outside the watcher because the process that SERVES the target is not
 * always the process that runs a watcher: `start:fe:api` deliberately starts no
 * payment manager (it would put a second credit poller behind every replica),
 * and it is exactly the process a buyer asks for the chain id. Both call
 * `verify()`; the verdict is per-process, which is what a per-process refusal
 * needs.
 */
type Verdict =
  | { state: 'unverified' }
  | { state: 'match'; chainId: number }
  | { state: 'mismatch'; expected: number; actual: number }

let verdict: Verdict = { state: 'unverified' }
// One read per process, however many callers ask. The watcher and the API
// bootstrap both call verify(); the second must not re-POST to the endpoint,
// and must not race the first to a different answer.
let inFlight: Promise<Verdict> | null = null

/**
 * The single I/O call, behind a seam.
 *
 * A function rather than an injected client because that is the whole surface a
 * test needs, and it keeps every caller of `verify()` argument-free — the
 * watcher and both bootstraps ask the same question with no idea how it is
 * answered. Replaced via `_reset`, which tests already call.
 */
type ChainIdReader = () => Promise<number>

// Not memoised, because `verify()` is: this runs at most once per process, and
// a cached client would only be a second thing for `_reset` to remember.
const readFromEndpoint: ChainIdReader = () =>
  createPublicClient({ transport: http(config.ethereum.rpcUrl) }).getChainId()

let readChainId: ChainIdReader = readFromEndpoint

const read = async (): Promise<Verdict> => {
  const expected = config.ethereum.chainId
  if (!config.ethereum.rpcUrl) return { state: 'unverified' }

  let actual: number
  try {
    actual = await readChainId()
  } catch (error) {
    // Unverified, not mismatched. See the type above.
    logger.warn(
      'Could not read the Ethereum chain id — USDC availability is unchanged',
      { expected, error },
    )
    return { state: 'unverified' }
  }

  if (actual === expected) {
    logger.info('Ethereum endpoint chain id verified', { chainId: actual })
    return { state: 'match', chainId: actual }
  }

  const problem =
    `configured ETH_CHAIN_ID ${expected}, but ETH_CHAIN_ENDPOINT is chain ` +
    `${actual}. The purchase flow is told to switch wallets to chain ` +
    `${expected} and pay the receiver there, which is not the chain this ` +
    'deployment watches. USDC purchases are now REFUSED until the two agree.'
  logger.error('Ethereum endpoint is not the configured chain', {
    expected,
    actual,
    problem,
  })
  await slackNotifier.send({
    title:
      ':rotating_light: USDC is on the wrong chain — purchases refused until ETH_CHAIN_ID and ETH_CHAIN_ENDPOINT agree',
    details: problem,
  })
  return { state: 'mismatch', expected, actual }
}

/**
 * Ask once, remember the answer.
 *
 * A `match` and a `mismatch` are both final for the life of the process — the
 * endpoint's chain id does not change under a running deployment, and re-reading
 * it would only add a way for a transient failure to un-alert a real mismatch.
 * An `unverified` result is NOT cached, so a boot-time outage is retried by the
 * next caller rather than leaving the check permanently unrun.
 */
const verify = async (): Promise<Verdict> => {
  if (!isUsdcConfigured()) return verdict
  if (verdict.state !== 'unverified') return verdict
  if (!inFlight) {
    inFlight = read().finally(() => {
      inFlight = null
    })
  }
  const result = await inFlight
  if (result.state !== 'unverified') verdict = result
  return result
}

/**
 * Synchronous, because every reader is on a request path.
 *
 * False until a mismatch has actually been observed, which is deliberate: the
 * first purchase after a boot may be quoted before `verify()` resolves. That
 * window is one RPC round-trip wide and closes permanently; the alternative —
 * refusing USDC until the check completes — makes a slow endpoint indistinguish-
 * able from a wrong one, and would fail closed on every restart.
 */
const isMismatched = () => verdict.state === 'mismatch'

const getVerdict = (): Verdict => verdict

/**
 * Tests only: the verdict is process-global by design.
 *
 * `reader` swaps the one call that touches the network, so a spec can drive
 * every branch — match, mismatch, unreadable — without an endpoint.
 */
const _reset = (reader: ChainIdReader = readFromEndpoint) => {
  verdict = { state: 'unverified' }
  inFlight = null
  readChainId = reader
}

export const usdcChainGuard = {
  verify,
  isMismatched,
  getVerdict,
  _reset,
}
