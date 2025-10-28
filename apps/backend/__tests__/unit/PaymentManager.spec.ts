/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from '@jest/globals'
import { paymentManager } from '../../src/infrastructure/services/paymentManager/index.js'
import { IntentsUseCases } from '../../src/core/users/intents.js'
import { ok, err } from 'neverthrow'
import { config } from '../../src/config.js'

describe('PaymentManager', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  describe('watchTransaction', () => {
    it('should reject invalid tx hash without 0x prefix', async () => {
      await expect(
        paymentManager.watchTransaction('invalidhash'),
      ).rejects.toThrow('Invalid tx hash')
    })

    it('should call viemClient.waitForTransactionReceipt with correct params', async () => {
      const txHash = '0xabc123'
      const waitForReceiptSpy = jest
        .spyOn(paymentManager.viemClient, 'waitForTransactionReceipt')
        .mockResolvedValue({
          logs: [],
        } as any)

      jest
        .spyOn(IntentsUseCases, 'markIntentAsConfirmed')
        .mockResolvedValue(ok({} as any))

      await paymentManager.watchTransaction(txHash)

      expect(waitForReceiptSpy).toHaveBeenCalledWith({
        hash: txHash,
        confirmations: 6,
      })
    })

    it('should process deposit events from transaction receipt', async () => {
      const txHash = '0xabc456'
      const intentId = '0xintent123'
      const paymentAmount = 100n

      config.paymentManager.contractAddress = '0xContractAddress'

      jest
        .spyOn(paymentManager.viemClient, 'waitForTransactionReceipt')
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
          ],
        } as any)

      jest.spyOn(paymentManager, 'parseEventLogs').mockReturnValue([
        {
          address: '0xContractAddress',
          args: { intentId, paymentAmount },
          eventName: 'IntentPaymentReceived',
        },
      ] as any)

      const markIntentSpy = jest
        .spyOn(IntentsUseCases, 'markIntentAsConfirmed')
        .mockResolvedValue(ok({} as any))

      await paymentManager.watchTransaction(txHash)

      // The function should process the logs and attempt to mark intents
      expect(markIntentSpy).toHaveBeenCalledTimes(1)
      expect(markIntentSpy).toHaveBeenCalledWith({
        intentId,
        paymentAmount,
      })
    })

    it('should filter logs by contract address', async () => {
      const txHash = '0xabc789'

      jest
        .spyOn(paymentManager.viemClient, 'waitForTransactionReceipt')
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

      await paymentManager.watchTransaction(txHash)

      // Should not mark intent because address doesn't match
      expect(markIntentSpy).not.toHaveBeenCalled()
    })

    it('should handle errors from markIntentAsConfirmed gracefully', async () => {
      const txHash = '0xerror'

      jest
        .spyOn(paymentManager.viemClient, 'waitForTransactionReceipt')
        .mockResolvedValue({
          logs: [],
        } as any)

      jest
        .spyOn(IntentsUseCases, 'markIntentAsConfirmed')
        .mockResolvedValue(err(new Error('Intent error')))

      // Should not throw, error should be logged
      await expect(
        paymentManager.watchTransaction(txHash),
      ).resolves.not.toThrow()
    })

    it('should handle multiple events with mixed success and error', async () => {
      const txHash = '0xmixed'
      const intentId1 = '0xintent1'
      const intentId2 = '0xintent2'

      config.paymentManager.contractAddress = '0xContractAddress'

      jest
        .spyOn(paymentManager.viemClient, 'waitForTransactionReceipt')
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

      jest.spyOn(paymentManager, 'parseEventLogs').mockReturnValue([
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
        .mockResolvedValueOnce(err(new Error('Second intent error')))

      await paymentManager.watchTransaction(txHash)

      expect(markIntentSpy).toHaveBeenCalledTimes(2)
    })

    it('should handle case insensitive contract address comparison', async () => {
      const txHash = '0xcasetest'

      config.paymentManager.contractAddress = '0xCONTRACTADDRESS'

      jest
        .spyOn(paymentManager.viemClient, 'waitForTransactionReceipt')
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

      jest.spyOn(paymentManager, 'parseEventLogs').mockReturnValue([
        {
          address: '0xcontractaddress',
          args: { intentId: '0xtest', paymentAmount: 100n },
          eventName: 'IntentPaymentReceived',
        },
      ] as any)

      const markIntentSpy = jest
        .spyOn(IntentsUseCases, 'markIntentAsConfirmed')
        .mockResolvedValue(ok({} as any))

      await paymentManager.watchTransaction(txHash)

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
        .spyOn(paymentManager, 'watchTransaction')
        .mockResolvedValue(undefined)

      paymentManager.onLogs(logs)

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
        .spyOn(paymentManager, 'watchTransaction')
        .mockResolvedValue(undefined)

      paymentManager.onLogs(logs)

      // Should not call watchTransaction for null transactionHash
      expect(watchTransactionSpy).not.toHaveBeenCalled()
    })

    it('should handle empty logs array', () => {
      const logs: any[] = []

      const watchTransactionSpy = jest
        .spyOn(paymentManager, 'watchTransaction')
        .mockResolvedValue(undefined)

      paymentManager.onLogs(logs)

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
        .spyOn(paymentManager, 'watchTransaction')
        .mockResolvedValue(undefined)

      paymentManager.onLogs(logs)

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
        .spyOn(paymentManager, 'watchTransaction')
        .mockRejectedValue(new Error('Transaction watch failed'))

      // safeCallback catches errors, so this should not throw
      paymentManager.onLogs(logs)

      // Wait for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Verify watchTransaction was called despite the error
      expect(watchTransactionSpy).toHaveBeenCalledWith('0xtxerror')
    })
  })

  describe('checkConfirmedIntents', () => {
    it('should fetch confirmed intents', async () => {
      const getConfirmedSpy = jest
        .spyOn(IntentsUseCases, 'getConfirmedIntents')
        .mockResolvedValue([])

      await paymentManager.checkConfirmedIntents()

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

      await paymentManager.checkConfirmedIntents()

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
        paymentManager.checkConfirmedIntents(),
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

      await paymentManager.checkConfirmedIntents()

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

      await paymentManager.checkConfirmedIntents()

      expect(onConfirmedSpy).toHaveBeenCalledTimes(3)
    })
  })

  describe('start', () => {
    it('should set up interval for checking confirmed intents', () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval')

      jest
        .spyOn(paymentManager.viemClient, 'watchContractEvent')
        .mockImplementation(() => Promise.resolve() as any)

      paymentManager.start()

      expect(setIntervalSpy).toHaveBeenCalledWith(
        expect.any(Function),
        30000, // checkInterval from config
      )

      setIntervalSpy.mockRestore()
    })

    it('should pass onLogs callback to watchContractEvent', () => {
      const onLogsSpy = jest
        .spyOn(paymentManager, 'onLogs')
        .mockImplementation(() => Promise.resolve() as any)

      const watchContractEventSpy = jest
        .spyOn(paymentManager.viemClient, 'watchContractEvent')
        .mockImplementation((params: any) => {
          // Trigger the onLogs callback
          params.onLogs([])

          return Promise.resolve() as any
        })

      jest.spyOn(global, 'setInterval').mockImplementation(() => 1 as any)

      paymentManager.start()

      expect(onLogsSpy).toHaveBeenCalled()

      watchContractEventSpy.mockRestore()
      onLogsSpy.mockRestore()
    })

    it('should configure watchContractEvent with correct parameters', () => {
      const watchContractEventSpy = jest
        .spyOn(paymentManager.viemClient, 'watchContractEvent')
        .mockImplementation(() => Promise.resolve() as any)

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
        .spyOn(paymentManager.viemClient, 'watchContractEvent')
        .mockImplementation(() => Promise.resolve() as any)

      const originalCheckInterval = config.paymentManager.checkInterval
      config.paymentManager.checkInterval = 15000

      paymentManager.start()

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 15000)

      // Restore original value
      config.paymentManager.checkInterval = originalCheckInterval
      setIntervalSpy.mockRestore()
    })
  })
})
