/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals'
import {
  _resetUsdcPaymentWatcher,
  ai3Chain,
  ai3PaymentWatcher,
  confirmedIntentsPoller,
  createPaymentWatcher,
  createUsdcChain,
  getUsdcPaymentWatcher,
  paymentManager,
} from '../../src/infrastructure/services/paymentManager/index.js'
import { IntentMispaymentReason } from '@auto-drive/models'
import { slackNotifier } from '../../src/infrastructure/services/slack/index.js'
import { PaymentMethod } from '@auto-drive/models'
import { IntentsUseCases } from '../../src/core/users/intents.js'
import { ok, err } from 'neverthrow'
import { config } from '../../src/config.js'
import { getAddress } from 'viem'
import { ObjectNotFoundError } from '../../src/errors/index.js'

// The real AI3 chain definition with a recognisable contract address, so the
// address-filtering tests read against a fixed value instead of mutating global
// config. Everything else — the ABI, the event name, the receipt.from mapping —
// is the definition the deployment actually runs.
const TEST_CONTRACT_ADDRESS = '0xContractAddress'
const watcher = createPaymentWatcher({
  ...ai3Chain,
  contractAddress: TEST_CONTRACT_ADDRESS,
})

describe('PaymentManager', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
  })

  afterEach(() => {
    // Stop what the start() tests started. Without this the confirmed-intent
    // poller's own double-start guard would make every start() test after the
    // first one a no-op.
    paymentManager.stop()
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  describe('watchTransaction', () => {
    it('should reject invalid tx hash without 0x prefix', async () => {
      await expect(
        watcher.watchTransaction('invalidhash'),
      ).rejects.toThrow('Invalid tx hash')
    })

    it('should call viemClient.waitForTransactionReceipt with correct params', async () => {
      const txHash = '0xabc123'
      const waitForReceiptSpy = jest
        .spyOn(watcher._viemClient, 'waitForTransactionReceipt')
        .mockResolvedValue({
          logs: [],
        } as any)

      jest
        .spyOn(IntentsUseCases, 'markIntentAsConfirmed')
        .mockResolvedValue(ok({} as any))

      await watcher.watchTransaction(txHash)

      expect(waitForReceiptSpy).toHaveBeenCalledWith({
        hash: txHash,
        confirmations: 6,
        // Bounded per chain: viem's own default is 180s, which on Ethereum is
        // roughly the confirmation wait alone.
        timeout: ai3Chain.receiptTimeoutMs,
      })
    })

    it('should process deposit events from transaction receipt', async () => {
      const txHash = '0xabc456'
      const intentId = '0xintent123'
      const paymentAmount = 100n
      const fromAddress = '0xSenderWallet'

      jest
        .spyOn(watcher._viemClient, 'waitForTransactionReceipt')
        .mockResolvedValue({
          from: fromAddress,
          logs: [
            {
              address: '0xContractAddress',
              data: '0x',
              topics: [],
              blockHash: '0x',
              blockNumber: 123n,
              logIndex: 0,
              transactionHash: txHash,
              transactionIndex: 0,
              removed: false,
            },
          ],
        } as any)

      jest.spyOn(watcher, '_parseEventLogs').mockReturnValue([
        {
          address: '0xContractAddress',
          args: { intentId, paymentAmount },
          eventName: 'IntentPaymentReceived',
          logIndex: 0,
        },
      ] as any)

      const markIntentSpy = jest
        .spyOn(IntentsUseCases, 'markIntentAsConfirmed')
        .mockResolvedValue(ok({} as any))

      await watcher.watchTransaction(txHash)

      // The function should process the logs and attempt to mark intents,
      // passing fromAddress captured from receipt.from and the tx hash, which is
      // what a refused payment is recorded against for admin review, plus the
      // log index that separates two payments sharing that hash.
      expect(markIntentSpy).toHaveBeenCalledTimes(1)
      expect(markIntentSpy).toHaveBeenCalledWith({
        intentId,
        paymentAmount,
        fromAddress,
        txHash,
        logIndex: 0,
      })
    })

    it('threads a distinct log index for two payments in one transaction', async () => {
      // payIntent(bytes32) is payable and callable from a contract, so one
      // transaction can emit the event twice for the same intent id with
      // different values. The hash is identical for both, so the log index is
      // the only thing that stops the second refusal from being filed as a
      // replay of the first — which would report one payment when two arrived.
      const txHash = '0xtwopayments'
      const intentId = '0xintent-double'

      jest
        .spyOn(watcher._viemClient, 'waitForTransactionReceipt')
        .mockResolvedValue({
          from: '0xSenderWallet',
          logs: [],
        } as any)

      jest.spyOn(watcher, '_parseEventLogs').mockReturnValue([
        {
          address: '0xContractAddress',
          args: { intentId, paymentAmount: 100n },
          eventName: 'IntentPaymentReceived',
          logIndex: 4,
        },
        {
          address: '0xContractAddress',
          args: { intentId, paymentAmount: 250n },
          eventName: 'IntentPaymentReceived',
          logIndex: 9,
        },
      ] as any)

      const markIntentSpy = jest
        .spyOn(IntentsUseCases, 'markIntentAsConfirmed')
        .mockResolvedValue(ok({} as any))

      await watcher.watchTransaction(txHash)

      expect(markIntentSpy).toHaveBeenCalledTimes(2)
      expect(markIntentSpy).toHaveBeenNthCalledWith(1, {
        intentId,
        paymentAmount: 100n,
        fromAddress: '0xSenderWallet',
        txHash,
        logIndex: 4,
      })
      expect(markIntentSpy).toHaveBeenNthCalledWith(2, {
        intentId,
        paymentAmount: 250n,
        fromAddress: '0xSenderWallet',
        txHash,
        logIndex: 9,
      })
    })

    it('settles two payments in one transaction one after the other', async () => {
      // markIntentAsConfirmed is a read-then-write on the intent's status.
      // Concurrently, both calls read PENDING, both take the settle path, and
      // the second write overwrites the first's amount with neither recorded as
      // a second payment — so the log index this threads would be decorating a
      // row that never gets written.
      const txHash = '0xsequential'
      const intentId = '0xintent-sequential'

      jest
        .spyOn(watcher._viemClient, 'waitForTransactionReceipt')
        .mockResolvedValue({ from: '0xSenderWallet', logs: [] } as any)

      jest.spyOn(watcher, '_parseEventLogs').mockReturnValue([
        {
          address: TEST_CONTRACT_ADDRESS,
          args: { intentId, paymentAmount: 100n },
          eventName: 'IntentPaymentReceived',
          logIndex: 1,
        },
        {
          address: TEST_CONTRACT_ADDRESS,
          args: { intentId, paymentAmount: 100n },
          eventName: 'IntentPaymentReceived',
          logIndex: 2,
        },
      ] as any)

      let releaseFirst: (() => void) | undefined
      const firstLanded = new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      const markIntentSpy = jest
        .spyOn(IntentsUseCases, 'markIntentAsConfirmed')
        .mockImplementationOnce(async () => {
          await firstLanded
          return ok({} as any)
        })
        .mockImplementation(async () => ok({} as any))

      const settled = watcher.watchTransaction(txHash)
      await Promise.resolve()

      // The second payment is not read until the first has been written.
      expect(markIntentSpy).toHaveBeenCalledTimes(1)

      releaseFirst?.()
      await settled

      expect(markIntentSpy).toHaveBeenCalledTimes(2)
      expect(markIntentSpy.mock.calls[1][0].logIndex).toBe(2)
    })

    it('should filter logs by contract address', async () => {
      const txHash = '0xabc789'

      jest
        .spyOn(watcher._viemClient, 'waitForTransactionReceipt')
        .mockResolvedValue({
          logs: [
            {
              address: '0xWrongContractAddress',
              data: '0x',
              topics: [],
              blockHash: '0x',
              blockNumber: 123n,
              logIndex: 0,
              transactionHash: txHash,
              transactionIndex: 0,
              removed: false,
            },
          ],
        } as any)

      const markIntentSpy = jest
        .spyOn(IntentsUseCases, 'markIntentAsConfirmed')
        .mockResolvedValue(ok({} as any))

      await watcher.watchTransaction(txHash)

      // Should not mark intent because address doesn't match
      expect(markIntentSpy).not.toHaveBeenCalled()
    })

    it('should handle errors from markIntentAsConfirmed gracefully', async () => {
      const txHash = '0xerror'

      jest
        .spyOn(watcher._viemClient, 'waitForTransactionReceipt')
        .mockResolvedValue({
          logs: [],
        } as any)

      jest
        .spyOn(IntentsUseCases, 'markIntentAsConfirmed')
        .mockResolvedValue(err(new ObjectNotFoundError('Intent error')))

      // Should not throw, error should be logged
      await expect(
        watcher.watchTransaction(txHash),
      ).resolves.not.toThrow()
    })

    it('should handle multiple events with mixed success and error', async () => {
      const txHash = '0xmixed'
      const intentId1 = '0xintent1'
      const intentId2 = '0xintent2'

      jest
        .spyOn(watcher._viemClient, 'waitForTransactionReceipt')
        .mockResolvedValue({
          logs: [
            {
              address: '0xContractAddress',
              data: '0x',
              topics: [],
              blockHash: '0x',
              blockNumber: 123n,
              logIndex: 0,
              transactionHash: txHash,
              transactionIndex: 0,
              removed: false,
            },
            {
              address: '0xContractAddress',
              data: '0x',
              topics: [],
              blockHash: '0x',
              blockNumber: 123n,
              logIndex: 1,
              transactionHash: txHash,
              transactionIndex: 1,
              removed: false,
            },
          ],
        } as any)

      jest.spyOn(watcher, '_parseEventLogs').mockReturnValue([
        {
          address: '0xContractAddress',
          args: { intentId: intentId1, paymentAmount: 100n },
          eventName: 'IntentPaymentReceived',
        },
        {
          address: '0xContractAddress',
          args: { intentId: intentId2, paymentAmount: 200n },
          eventName: 'IntentPaymentReceived',
        },
      ] as any)

      const markIntentSpy = jest
        .spyOn(IntentsUseCases, 'markIntentAsConfirmed')
        .mockResolvedValueOnce(ok({} as any))
        .mockResolvedValueOnce(
          err(new ObjectNotFoundError('Second intent error')),
        )

      await watcher.watchTransaction(txHash)

      expect(markIntentSpy).toHaveBeenCalledTimes(2)
    })

    it('should handle case insensitive contract address comparison', async () => {
      const txHash = '0xcasetest'

      const upperCaseWatcher = createPaymentWatcher({
        ...ai3Chain,
        contractAddress: '0xCONTRACTADDRESS',
      })

      jest
        .spyOn(upperCaseWatcher._viemClient, 'waitForTransactionReceipt')
        .mockResolvedValue({
          logs: [
            {
              address: '0xcontractaddress',
              data: '0x',
              topics: [],
              blockHash: '0x',
              blockNumber: 123n,
              logIndex: 0,
              transactionHash: txHash,
              transactionIndex: 0,
              removed: false,
            },
          ],
        } as any)

      jest.spyOn(upperCaseWatcher, '_parseEventLogs').mockReturnValue([
        {
          address: '0xcontractaddress',
          args: { intentId: '0xtest', paymentAmount: 100n },
          eventName: 'IntentPaymentReceived',
        },
      ] as any)

      const markIntentSpy = jest
        .spyOn(IntentsUseCases, 'markIntentAsConfirmed')
        .mockResolvedValue(ok({} as any))

      await upperCaseWatcher.watchTransaction(txHash)

      // Should match because comparison is case-insensitive
      expect(markIntentSpy).toHaveBeenCalled()
    })
  })

  describe('onLogs', () => {
    it('should log deposit events', () => {
      const logs = [
        {
          transactionHash: '0xtx1',
          address: '0xaddr1',
        },
        {
          transactionHash: '0xtx2',
          address: '0xaddr2',
        },
      ] as any[]

      const watchTransactionSpy = jest
        .spyOn(watcher, 'watchTransaction')
        .mockResolvedValue(undefined)

      watcher._onLogs(logs)

      // Should call watchTransaction for each log's transaction hash
      expect(watchTransactionSpy).toHaveBeenCalledTimes(2)
      expect(watchTransactionSpy).toHaveBeenCalledWith('0xtx1')
      expect(watchTransactionSpy).toHaveBeenCalledWith('0xtx2')
    })

    it('should handle null transaction hashes gracefully', () => {
      const logs = [
        {
          transactionHash: null,
          address: '0xaddr1',
        },
      ] as any[]

      const watchTransactionSpy = jest
        .spyOn(watcher, 'watchTransaction')
        .mockResolvedValue(undefined)

      watcher._onLogs(logs)

      // Should not call watchTransaction for null transactionHash
      expect(watchTransactionSpy).not.toHaveBeenCalled()
    })

    it('should handle empty logs array', () => {
      const logs: any[] = []

      const watchTransactionSpy = jest
        .spyOn(watcher, 'watchTransaction')
        .mockResolvedValue(undefined)

      watcher._onLogs(logs)

      expect(watchTransactionSpy).not.toHaveBeenCalled()
    })

    it('should handle mixed valid and null transaction hashes', () => {
      const logs = [
        {
          transactionHash: '0xtx1',
          address: '0xaddr1',
        },
        {
          transactionHash: null,
          address: '0xaddr2',
        },
        {
          transactionHash: '0xtx2',
          address: '0xaddr3',
        },
      ] as any[]

      const watchTransactionSpy = jest
        .spyOn(watcher, 'watchTransaction')
        .mockResolvedValue(undefined)

      watcher._onLogs(logs)

      // Should only call watchTransaction for non-null hashes
      expect(watchTransactionSpy).toHaveBeenCalledTimes(2)
      expect(watchTransactionSpy).toHaveBeenCalledWith('0xtx1')
      expect(watchTransactionSpy).toHaveBeenCalledWith('0xtx2')
    })

    it('should handle errors when calling watchTransaction', async () => {
      const logs = [
        {
          transactionHash: '0xtxerror',
          address: '0xaddr1',
        },
      ] as any[]

      const watchTransactionSpy = jest
        .spyOn(watcher, 'watchTransaction')
        .mockRejectedValue(new Error('Transaction watch failed'))

      // safeCallback catches errors, so this should not throw
      watcher._onLogs(logs)

      // Flush microtasks instead of waiting on timers (fake timers active)
      await Promise.resolve()

      // Verify watchTransaction was called despite the error
      expect(watchTransactionSpy).toHaveBeenCalledWith('0xtxerror')
    })
  })

  describe('checkConfirmedIntents', () => {
    it('should fetch confirmed intents', async () => {
      const getConfirmedSpy = jest
        .spyOn(IntentsUseCases, 'getConfirmedIntents')
        .mockResolvedValue([])

      await confirmedIntentsPoller._checkConfirmedIntents()

      expect(getConfirmedSpy).toHaveBeenCalled()
    })

    it('should process each confirmed intent', async () => {
      const intents = [
        {
          id: '0xintent1',
          userPublicId: 'user1',
          status: 'CONFIRMED',
        },
        {
          id: '0xintent2',
          userPublicId: 'user2',
          status: 'CONFIRMED',
        },
      ] as any[]

      jest
        .spyOn(IntentsUseCases, 'getConfirmedIntents')
        .mockResolvedValue(intents)

      const onConfirmedSpy = jest
        .spyOn(IntentsUseCases, 'onConfirmedIntent')
        .mockResolvedValue(ok(undefined))

      await confirmedIntentsPoller._checkConfirmedIntents()

      expect(onConfirmedSpy).toHaveBeenCalledTimes(2)
      expect(onConfirmedSpy).toHaveBeenCalledWith('0xintent1')
      expect(onConfirmedSpy).toHaveBeenCalledWith('0xintent2')
    })

    it('should handle errors when processing confirmed intents', async () => {
      const intents = [
        {
          id: '0xintenterror',
          userPublicId: 'user1',
          status: 'CONFIRMED',
        },
      ] as any[]

      jest
        .spyOn(IntentsUseCases, 'getConfirmedIntents')
        .mockResolvedValue(intents)

      const onConfirmedSpy = jest
        .spyOn(IntentsUseCases, 'onConfirmedIntent')
        .mockResolvedValue(err(new Error('Processing error')))

      // Should not throw, error should be logged
      await expect(
        confirmedIntentsPoller._checkConfirmedIntents(),
      ).resolves.not.toThrow()

      expect(onConfirmedSpy).toHaveBeenCalled()
    })

    it('should log success when intents are confirmed', async () => {
      const intents = [
        {
          id: '0xintentsuccess',
          userPublicId: 'user1',
          status: 'CONFIRMED',
        },
      ] as any[]

      jest
        .spyOn(IntentsUseCases, 'getConfirmedIntents')
        .mockResolvedValue(intents)

      const onConfirmedSpy = jest
        .spyOn(IntentsUseCases, 'onConfirmedIntent')
        .mockResolvedValue(ok(undefined))

      await confirmedIntentsPoller._checkConfirmedIntents()

      expect(onConfirmedSpy).toHaveBeenCalledWith('0xintentsuccess')
    })

    it('should handle mixed success and error scenarios', async () => {
      const intents = [
        {
          id: '0xintentersuccess',
          userPublicId: 'user1',
          status: 'CONFIRMED',
        },
        {
          id: '0xintenterror',
          userPublicId: 'user2',
          status: 'CONFIRMED',
        },
        {
          id: '0xintentersuccess2',
          userPublicId: 'user3',
          status: 'CONFIRMED',
        },
      ] as any[]

      jest
        .spyOn(IntentsUseCases, 'getConfirmedIntents')
        .mockResolvedValue(intents)

      const onConfirmedSpy = jest
        .spyOn(IntentsUseCases, 'onConfirmedIntent')
        .mockResolvedValueOnce(ok(undefined))
        .mockResolvedValueOnce(err(new Error('Processing error')))
        .mockResolvedValueOnce(ok(undefined))

      await confirmedIntentsPoller._checkConfirmedIntents()

      expect(onConfirmedSpy).toHaveBeenCalledTimes(3)
    })

    // The case the two tests above do not cover: they return errors, and a
    // returned error was always handled. A THROWN one used to escape the loop
    // and abandon every intent behind it — users who paid correctly, skipped,
    // every tick, for as long as the poison row sat in the batch.
    it('should keep processing the batch when one intent throws', async () => {
      const intents = [
        { id: '0xbefore', userPublicId: 'user1', status: 'CONFIRMED' },
        { id: '0xpoison', userPublicId: 'user2', status: 'CONFIRMED' },
        { id: '0xafter', userPublicId: 'user3', status: 'CONFIRMED' },
      ] as any[]

      jest
        .spyOn(IntentsUseCases, 'getConfirmedIntents')
        .mockResolvedValue(intents)

      const onConfirmedSpy = jest
        .spyOn(IntentsUseCases, 'onConfirmedIntent')
        .mockResolvedValueOnce(ok(undefined))
        // What a zero shannonsPerByte produces: BigInt division by zero throws
        // a RangeError rather than returning an err().
        .mockRejectedValueOnce(new RangeError('Division by zero'))
        .mockResolvedValueOnce(ok(undefined))

      await expect(
        confirmedIntentsPoller._checkConfirmedIntents(),
      ).resolves.not.toThrow()

      // All three attempted, and specifically the one AFTER the thrower.
      expect(onConfirmedSpy).toHaveBeenCalledTimes(3)
      expect(onConfirmedSpy).toHaveBeenCalledWith('0xafter')
    })
  })

  describe('start', () => {
    it('should set up interval for checking confirmed intents', () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval')

      jest
        .spyOn(ai3PaymentWatcher._viemClient, 'watchContractEvent')
        // Returns the unwatch function, like the real one: stop() calls it.
        .mockImplementation(() => jest.fn())

      paymentManager.start()

      expect(setIntervalSpy).toHaveBeenCalledWith(
        expect.any(Function),
        30000, // checkInterval from config
      )

      setIntervalSpy.mockRestore()
    })

    it('should pass onLogs callback to watchContractEvent', () => {
      const onLogsSpy = jest
        .spyOn(ai3PaymentWatcher, '_onLogs')
        .mockImplementation(() => Promise.resolve() as any)

      const watchContractEventSpy = jest
        .spyOn(ai3PaymentWatcher._viemClient, 'watchContractEvent')
        .mockImplementation((params: any) => {
          // Trigger the onLogs callback
          params.onLogs([])

          return jest.fn()
        })

      jest.spyOn(global, 'setInterval').mockImplementation(() => 1 as any)

      paymentManager.start()

      expect(onLogsSpy).toHaveBeenCalled()

      watchContractEventSpy.mockRestore()
      onLogsSpy.mockRestore()
    })

    it('should configure watchContractEvent with correct parameters', () => {
      const watchContractEventSpy = jest
        .spyOn(ai3PaymentWatcher._viemClient, 'watchContractEvent')
        // Returns the unwatch function, like the real one: stop() calls it.
        .mockImplementation(() => jest.fn())

      jest.spyOn(global, 'setInterval').mockImplementation(() => 1 as any)

      paymentManager.start()

      expect(watchContractEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          address: config.paymentManager.contractAddress,
          eventName: 'IntentPaymentReceived',
          onLogs: expect.any(Function),
        }),
      )

      watchContractEventSpy.mockRestore()
    })

    it('should use checkInterval from config for setInterval', () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval')

      jest
        .spyOn(ai3PaymentWatcher._viemClient, 'watchContractEvent')
        // Returns the unwatch function, like the real one: stop() calls it.
        .mockImplementation(() => jest.fn())

      const originalCheckInterval = config.paymentManager.checkInterval
      config.paymentManager.checkInterval = 15000

      paymentManager.start()

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 15000)

      // Restore original value
      config.paymentManager.checkInterval = originalCheckInterval
      setIntervalSpy.mockRestore()
    })
  })
  // -------------------------------------------------------------------------
  // Ethereum / USDC instance
  // -------------------------------------------------------------------------

  describe('usdc watcher', () => {
    const RECEIVER = '0x1111111111111111111111111111111111111111'
    const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
    const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f'

    const usdcWatcher = createPaymentWatcher(
      createUsdcChain('http://example.org', RECEIVER, USDC),
    )

    const receiptWithLog = (txHash: string) =>
      ({
        // The relayer, deliberately different from the payer below: an ERC20
        // transfer can be submitted by someone other than whoever paid.
        from: '0xRelayerWallet',
        logs: [
          {
            address: RECEIVER,
            data: '0x',
            topics: [],
            blockHash: '0x',
            blockNumber: 123n,
            logIndex: 0,
            transactionHash: txHash,
            transactionIndex: 0,
            removed: false,
          },
        ],
      }) as any

    it('credits the token amount and the event payer, not receipt.from', async () => {
      const txHash = '0xusdcpayment'
      const intentId = '0xintent-usdc'

      jest
        .spyOn(usdcWatcher._viemClient, 'waitForTransactionReceipt')
        .mockResolvedValue(receiptWithLog(txHash))

      jest.spyOn(usdcWatcher, '_parseEventLogs').mockReturnValue([
        {
          address: RECEIVER,
          args: {
            intentId,
            token: USDC,
            amount: 5_250_000n,
            payer: '0xPayerWallet',
          },
          eventName: 'IntentTokenPaymentReceived',
          logIndex: 3,
        },
      ] as any)

      const markIntentSpy = jest
        .spyOn(IntentsUseCases, 'markIntentAsConfirmed')
        .mockResolvedValue(ok({} as any))

      await usdcWatcher.watchTransaction(txHash)

      // tokenAmount, not paymentAmount: the columns are denominated in
      // different assets, and the asset-mismatch guard in markIntentAsConfirmed
      // is what tells them apart. fromAddress is the event's payer — refunding
      // receipt.from would pay back a relayer who sent nothing.
      expect(markIntentSpy).toHaveBeenCalledTimes(1)
      expect(markIntentSpy).toHaveBeenCalledWith({
        intentId,
        tokenAmount: 5_250_000n,
        fromAddress: '0xPayerWallet',
        txHash,
        logIndex: 3,
      })
      expect(markIntentSpy.mock.calls[0][0]).not.toHaveProperty('paymentAmount')
    })

    it('refuses a payment in a token this receiver was not configured for', async () => {
      const txHash = '0xwrongtoken'

      jest
        .spyOn(usdcWatcher._viemClient, 'waitForTransactionReceipt')
        .mockResolvedValue(receiptWithLog(txHash))

      jest.spyOn(usdcWatcher, '_parseEventLogs').mockReturnValue([
        {
          address: RECEIVER,
          args: {
            intentId: '0xintent-dai',
            token: DAI,
            amount: 5_000_000_000_000_000_000n,
            payer: '0xPayerWallet',
          },
          eventName: 'IntentTokenPaymentReceived',
          logIndex: 0,
        },
      ] as any)

      const markIntentSpy = jest
        .spyOn(IntentsUseCases, 'markIntentAsConfirmed')
        .mockResolvedValue(ok({} as any))
      const recordSpy = jest
        .spyOn(IntentsUseCases, 'recordRefusedPayment')
        .mockResolvedValue(undefined)

      await usdcWatcher.watchTransaction(txHash)

      // Not credited: every number downstream assumes 6 decimals, so an
      // 18-decimal token would read as a payment 10^12 times the one that
      // arrived, against a quote denominated in dollars.
      expect(markIntentSpy).not.toHaveBeenCalled()

      // Filed all the same. The transfer happened, and refusing it settles
      // nothing on chain — an admin needs a row, not a log line. No amount: it
      // is denominated in a token we cannot name, and token_amount means USDC.
      expect(recordSpy).toHaveBeenCalledWith({
        intentId: '0xintent-dai',
        reason: IntentMispaymentReason.UNRECOGNISED_TOKEN,
        expectedPaymentMethod: PaymentMethod.USDC_ETH,
        fromAddress: '0xPayerWallet',
        txHash,
        logIndex: 0,
      })
    })

    it('compares the token address case-insensitively', async () => {
      const txHash = '0xchecksum'

      jest
        .spyOn(usdcWatcher._viemClient, 'waitForTransactionReceipt')
        .mockResolvedValue(receiptWithLog(txHash))

      jest.spyOn(usdcWatcher, '_parseEventLogs').mockReturnValue([
        {
          address: RECEIVER,
          args: {
            intentId: '0xintent-checksum',
            // Checksummed, where the configured value was all lowercase. An
            // operator pasting either form out of a block explorer must not
            // turn every payment into an ignored event.
            token: getAddress(USDC),
            amount: 1_000_000n,
            payer: '0xPayerWallet',
          },
          eventName: 'IntentTokenPaymentReceived',
          logIndex: 0,
        },
      ] as any)

      const markIntentSpy = jest
        .spyOn(IntentsUseCases, 'markIntentAsConfirmed')
        .mockResolvedValue(ok({} as any))

      await usdcWatcher.watchTransaction(txHash)

      expect(markIntentSpy).toHaveBeenCalledTimes(1)
    })

    it('ignores an event from a contract that is not the receiver', async () => {
      const txHash = '0xotherContract'

      jest
        .spyOn(usdcWatcher._viemClient, 'waitForTransactionReceipt')
        .mockResolvedValue(receiptWithLog(txHash))

      jest.spyOn(usdcWatcher, '_parseEventLogs').mockReturnValue([
        {
          address: '0x2222222222222222222222222222222222222222',
          args: {
            intentId: '0xintent-elsewhere',
            token: USDC,
            amount: 1_000_000n,
            payer: '0xPayerWallet',
          },
          eventName: 'IntentTokenPaymentReceived',
          logIndex: 0,
        },
      ] as any)

      const markIntentSpy = jest
        .spyOn(IntentsUseCases, 'markIntentAsConfirmed')
        .mockResolvedValue(ok({} as any))

      await usdcWatcher.watchTransaction(txHash)

      expect(markIntentSpy).not.toHaveBeenCalled()
    })

    it('waits for the Ethereum confirmation count', async () => {
      const txHash = '0xconfirmations'

      const waitSpy = jest
        .spyOn(usdcWatcher._viemClient, 'waitForTransactionReceipt')
        .mockResolvedValue({ from: '0xRelayer', logs: [] } as any)

      jest
        .spyOn(IntentsUseCases, 'markIntentAsConfirmed')
        .mockResolvedValue(ok({} as any))

      await usdcWatcher.watchTransaction(txHash)

      expect(waitSpy).toHaveBeenCalledWith({
        hash: txHash,
        confirmations: config.ethereum.confirmations,
        // Ethereum gets a longer budget than Auto EVM: 6 confirmations is ~72s
        // of it, so viem's 180s default would time out a transaction that took
        // two minutes to be included and raise a payment-failed alert for a
        // payment that was fine.
        timeout: usdcWatcher.chain.receiptTimeoutMs,
      })
      expect(usdcWatcher.chain.receiptTimeoutMs).toBeGreaterThan(
        ai3Chain.receiptTimeoutMs,
      )
    })
  })

  describe('startup recovery', () => {
    it('sweeps only the AI3 chain rows', async () => {
      const getPendingSpy = jest
        .spyOn(IntentsUseCases, 'getPendingWithTxHash')
        .mockResolvedValue([])

      await watcher._recoverOrphanedTransactions()

      // Scoped to this watcher's asset. Handed an Ethereum hash, the Auto EVM
      // client does not fail — it waits out its receipt timeout — so an
      // unfiltered sweep would spend its startup window on rows it cannot see.
      expect(getPendingSpy).toHaveBeenCalledWith(PaymentMethod.AI3_NATIVE)
    })

    it('sweeps only the USDC chain rows', async () => {
      const usdcWatcher = createPaymentWatcher(
        createUsdcChain(
          'http://example.org',
          '0x1111111111111111111111111111111111111111',
          '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        ),
      )

      const getPendingSpy = jest
        .spyOn(IntentsUseCases, 'getPendingWithTxHash')
        .mockResolvedValue([])

      await usdcWatcher._recoverOrphanedTransactions()

      expect(getPendingSpy).toHaveBeenCalledWith(PaymentMethod.USDC_ETH)
    })

    it('re-watches every orphan it finds', async () => {
      jest.spyOn(IntentsUseCases, 'getPendingWithTxHash').mockResolvedValue([
        { id: 'intent-1', txHash: '0xorphan1' },
        { id: 'intent-2', txHash: '0xorphan2' },
        // No hash: nothing to look up, and not an error.
        { id: 'intent-3' },
      ] as any)

      const watchSpy = jest
        .spyOn(watcher, 'watchTransaction')
        .mockResolvedValue(undefined)

      await watcher._recoverOrphanedTransactions()

      expect(watchSpy).toHaveBeenCalledTimes(2)
      expect(watchSpy).toHaveBeenCalledWith('0xorphan1')
      expect(watchSpy).toHaveBeenCalledWith('0xorphan2')
    })
  })

  describe('watchTransaction routing', () => {
    it('sends an AI3 hash to the Auto EVM watcher', async () => {
      const ai3Spy = jest
        .spyOn(ai3PaymentWatcher, 'watchTransaction')
        .mockResolvedValue(undefined)

      await paymentManager.watchTransaction('0xai3', PaymentMethod.AI3_NATIVE)

      expect(ai3Spy).toHaveBeenCalledWith('0xai3')
    })

    it('defaults to the Auto EVM watcher when no method is given', async () => {
      const ai3Spy = jest
        .spyOn(ai3PaymentWatcher, 'watchTransaction')
        .mockResolvedValue(undefined)

      // A watch-intent-tx task queued before the second chain existed carries no
      // payment method, and every one of them is AI3.
      await paymentManager.watchTransaction('0xlegacy')

      expect(ai3Spy).toHaveBeenCalledWith('0xlegacy')
    })

    it('refuses a USDC hash when Ethereum is not configured', async () => {
      // .env.test sets none of the three Ethereum variables, so this deployment
      // has no USDC watcher. Throwing keeps the task on its retry path and then
      // in the error queue, which is where a payment nobody is watching for
      // belongs — the alternative is watching an Ethereum hash on Auto EVM.
      await expect(
        paymentManager.watchTransaction('0xusdc', PaymentMethod.USDC_ETH),
      ).rejects.toThrow('no Ethereum USDC configuration')
    })
  })

  describe('confirmedIntentsPoller', () => {
    it('does not start a second interval', () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval')

      confirmedIntentsPoller.start()
      confirmedIntentsPoller.start()

      // Two loops would both read the same freshly CONFIRMED row and both grant
      // its credits: onConfirmedIntent checks for COMPLETED and then writes,
      // with no lock between the two.
      expect(setIntervalSpy).toHaveBeenCalledTimes(1)

      confirmedIntentsPoller.stop()
      setIntervalSpy.mockRestore()
    })
  })

  describe('payment configuration verification', () => {
    const RECEIVER = '0x1111111111111111111111111111111111111111'
    const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
    const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f'

    it('escalates a token address that disagrees with the deployed receiver', async () => {
      const watcherUnderTest = createPaymentWatcher(
        createUsdcChain('http://example.org', RECEIVER, USDC),
      )

      // The receiver's token is immutable, so this is not one bad payment — it
      // is every payment to that contract being refused, and the only symptom
      // otherwise is silence.
      jest
        .spyOn(watcherUnderTest._viemClient, 'readContract')
        .mockResolvedValue(DAI as any)
      const slackSpy = jest
        .spyOn(slackNotifier, 'send')
        .mockResolvedValue(true)

      await watcherUnderTest._verifyConfiguration()

      expect(slackSpy).toHaveBeenCalledTimes(1)
      expect(slackSpy.mock.calls[0][0].details).toContain(
        getAddress(DAI),
      )
    })

    it('stays quiet when the configuration matches', async () => {
      const watcherUnderTest = createPaymentWatcher(
        createUsdcChain('http://example.org', RECEIVER, USDC),
      )

      jest
        .spyOn(watcherUnderTest._viemClient, 'readContract')
        .mockResolvedValue(getAddress(USDC) as any)
      const slackSpy = jest
        .spyOn(slackNotifier, 'send')
        .mockResolvedValue(true)

      await watcherUnderTest._verifyConfiguration()

      expect(slackSpy).not.toHaveBeenCalled()
    })

    it('does not escalate when the check itself cannot run', async () => {
      const watcherUnderTest = createPaymentWatcher(
        createUsdcChain('http://example.org', RECEIVER, USDC),
      )

      // An RPC that is down at boot says nothing about the configuration.
      // Treating it as a mismatch would page someone for an outage that fixes
      // itself, and treating it as a pass is exactly what it is: unknown.
      jest
        .spyOn(watcherUnderTest._viemClient, 'readContract')
        .mockRejectedValue(new Error('connect ECONNREFUSED'))
      const slackSpy = jest
        .spyOn(slackNotifier, 'send')
        .mockResolvedValue(true)

      await expect(
        watcherUnderTest._verifyConfiguration(),
      ).resolves.not.toThrow()
      expect(slackSpy).not.toHaveBeenCalled()
    })
  })

  describe('watcher lifecycle', () => {
    it('subscribes once, however many times it is started', () => {
      const unwatch = jest.fn()
      const watchSpy = jest
        .spyOn(ai3PaymentWatcher._viemClient, 'watchContractEvent')
        .mockImplementation(() => unwatch)
      jest.spyOn(global, 'setInterval').mockImplementation(() => 1 as any)

      ai3PaymentWatcher.start()
      ai3PaymentWatcher.start()

      // A second subscription would process every event twice and leak the
      // first unsubscribe, leaving a watcher stop() cannot turn off.
      expect(watchSpy).toHaveBeenCalledTimes(1)

      ai3PaymentWatcher.stop()
      expect(unwatch).toHaveBeenCalledTimes(1)
    })

    it('reports subscription failures instead of going quiet', () => {
      let raise: ((error: Error) => void) | undefined
      jest
        .spyOn(ai3PaymentWatcher._viemClient, 'watchContractEvent')
        .mockImplementation((params: any) => {
          raise = params.onError
          return jest.fn()
        })
      jest.spyOn(global, 'setInterval').mockImplementation(() => 1 as any)

      ai3PaymentWatcher.start()

      // viem swallows poll failures into onError. Without a handler a bad
      // endpoint or a rate-limited provider yields zero logs and zero log
      // lines, indefinitely — the primary observation channel for real money
      // failing closed and mute.
      expect(raise).toBeInstanceOf(Function)
      expect(() => raise?.(new Error('filter not found'))).not.toThrow()
    })
  })

  describe('usdc watcher configuration', () => {
    const originalEthereum = { ...config.ethereum }

    afterEach(() => {
      Object.assign(config.ethereum, originalEthereum)
      _resetUsdcPaymentWatcher()
    })

    it('has no watcher when no receiver is configured', () => {
      expect(getUsdcPaymentWatcher()).toBeNull()
    })

    it('leaves an Ethereum endpoint on its own alone', () => {
      // ETH_CHAIN_ENDPOINT has other readers — #811's treasury balance check,
      // and the oracle before #807 — so a deployment can hold one for reasons
      // that have nothing to do with payments. Failing a boot over it would
      // take down downloads and publishing too, since both import this module.
      config.ethereum.rpcUrl = 'http://example.org'

      expect(getUsdcPaymentWatcher()).toBeNull()
    })

    it('refuses a receiver without the rest of its configuration', () => {
      config.ethereum.usdcReceiverAddress =
        '0x1111111111111111111111111111111111111111'
      config.ethereum.rpcUrl = undefined
      config.ethereum.usdcTokenAddress = undefined

      // Loud, because a watcher that cannot see its receiver and a working
      // watcher on a quiet day look identical from outside.
      expect(() => getUsdcPaymentWatcher()).toThrow(
        /ETH_CHAIN_ENDPOINT and USDC_TOKEN_ADDRESS are not/,
      )
    })

    it('builds and memoises a watcher once fully configured', () => {
      config.ethereum.rpcUrl = 'http://example.org'
      config.ethereum.usdcReceiverAddress =
        '0x1111111111111111111111111111111111111111'
      config.ethereum.usdcTokenAddress =
        '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

      const first = getUsdcPaymentWatcher()
      expect(first).not.toBeNull()
      expect(first?.chain.paymentMethod).toBe(PaymentMethod.USDC_ETH)
      // Checksummed on the way in, so a lowercase env value still matches the
      // address the events carry.
      expect(first?.chain.contractAddress).toBe(
        getAddress('0x1111111111111111111111111111111111111111'),
      )
      expect(getUsdcPaymentWatcher()).toBe(first)
    })

    it('routes a USDC hash to the configured watcher', async () => {
      config.ethereum.rpcUrl = 'http://example.org'
      config.ethereum.usdcReceiverAddress =
        '0x1111111111111111111111111111111111111111'
      config.ethereum.usdcTokenAddress =
        '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

      const usdcWatcher = getUsdcPaymentWatcher()
      const watchSpy = jest
        .spyOn(usdcWatcher!, 'watchTransaction')
        .mockResolvedValue(undefined)
      const ai3Spy = jest
        .spyOn(ai3PaymentWatcher, 'watchTransaction')
        .mockResolvedValue(undefined)

      await paymentManager.watchTransaction('0xusdc', PaymentMethod.USDC_ETH)

      expect(watchSpy).toHaveBeenCalledWith('0xusdc')
      expect(ai3Spy).not.toHaveBeenCalled()
    })
  })
})
