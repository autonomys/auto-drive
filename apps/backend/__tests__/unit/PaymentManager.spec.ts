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
  })

  afterEach(() => {
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
  })
})
