import { jest } from '@jest/globals'
import { IntentsUseCases } from '../../../src/core/users/intents.js'
import { intentsRepository } from '../../../src/infrastructure/repositories/users/intents.js'
import { EventRouter } from '../../../src/infrastructure/eventRouter/index.js'
import { SubscriptionsUseCases } from '../../../src/core/users/subscriptions.js'
import { ForbiddenError } from '../../../src/errors/index.js'
import { IntentStatus, type Intent, type User } from '@auto-drive/models'
import { config } from '../../../src/config.js'
import { ok } from 'neverthrow'

describe('IntentsUseCases', () => {
  const now = new Date()
  const user: User = {
    id: 'user-id',
    publicId: 'pub-1',
    walletAddress: '0xabc',
    createdAt: now,
    updatedAt: now,
    authProvider: 'github',
  } as unknown as User

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('createIntent should create PENDING intent for user', async () => {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
    config.paymentManager.pricePerMB = 7
    jest
      .spyOn(intentsRepository, 'createIntent')
      .mockImplementation(async (intent) => intent)

    const intent = await IntentsUseCases.createIntent(user, { expiresAt })

    expect(intent.userPublicId).toBe(user.publicId)
    expect(intent.status).toBe(IntentStatus.PENDING)
    expect(intent.expiresAt.getTime()).toBeCloseTo(expiresAt.getTime(), -2)
    expect(intent.pricePerMB).toBe(7)
  })

  it('getIntent should return ok when found', async () => {
    const intent: Intent = {
      id: '0x1',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      pricePerMB: 1,
      expiresAt: new Date(Date.now() + 1000),
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)

    const result = await IntentsUseCases.getIntent(intent.id)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().id).toBe(intent.id)
  })

  it('getIntent should error when not found', async () => {
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(null)
    const result = await IntentsUseCases.getIntent('0xnope')
    expect(result.isErr()).toBe(true)
  })

  it('triggerWatchIntent should publish event and set txHash when user matches', async () => {
    const intent: Intent = {
      id: '0x2',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      pricePerMB: 1,
      expiresAt: new Date(Date.now() + 1000),
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    const updateSpy = jest
      .spyOn(intentsRepository, 'updateIntent')
      .mockResolvedValue({ ...intent, txHash: '0xhash' })
    const publishSpy = jest
      .spyOn(EventRouter, 'publish')
      .mockImplementation(() => Promise.resolve())

    const res = await IntentsUseCases.triggerWatchIntent({
      executor: user,
      txHash: '0xhash',
      intentId: intent.id,
    })

    expect(res.isOk()).toBe(true)
    expect(publishSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'watch-intent-tx' }),
    )
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: intent.id, txHash: '0xhash' }),
    )
  })

  it('triggerWatchIntent should forbid when user mismatches', async () => {
    const intent: Intent = {
      id: '0x3',
      userPublicId: 'other',
      status: IntentStatus.PENDING,
      expiresAt: new Date(Date.now() + 1000),
      pricePerMB: 1,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)

    const res = await IntentsUseCases.triggerWatchIntent({
      executor: user,
      txHash: '0xhash',
      intentId: intent.id,
    })

    expect(res.isErr()).toBe(true)
    expect(res._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
  })

  it('markIntentAsConfirmed should set status CONFIRMED and deposit amount', async () => {
    const intent: Intent = {
      id: '0x4',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      expiresAt: new Date(Date.now() + 1000),
      pricePerMB: 1,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    const updateSpy = jest
      .spyOn(intentsRepository, 'updateIntent')
      .mockResolvedValue({
        ...intent,
        status: IntentStatus.CONFIRMED,
        depositAmount: 10n,
      })

    const res = await IntentsUseCases.markIntentAsConfirmed({
      intentId: intent.id,
      depositAmount: 10n,
    })

    expect(res.isOk()).toBe(true)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: intent.id,
        status: IntentStatus.CONFIRMED,
        depositAmount: 10n,
      }),
    )
  })

  it('onConfirmedIntent should add credits and complete intent', async () => {
    config.paymentManager.pricePerMB = 1
    const depositAmount = 123n * 10n ** 12n // yields 123 credits when pricePerMB=1
    const intent: Intent = {
      id: '0x5',
      userPublicId: user.publicId,
      status: IntentStatus.CONFIRMED,
      expiresAt: new Date(Date.now() + 1000),
      depositAmount,
      pricePerMB: 1,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    const addCreditsSpy = jest
      .spyOn(SubscriptionsUseCases, 'addCreditsToSubscription')
      .mockResolvedValue(ok())
    const updateSpy = jest
      .spyOn(intentsRepository, 'updateIntent')
      .mockResolvedValue({ ...intent, status: IntentStatus.COMPLETED })

    const res = await IntentsUseCases.onConfirmedIntent(intent.id)

    expect(res.isOk()).toBe(true)
    expect(addCreditsSpy).toHaveBeenCalledWith(user.publicId, 123)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: intent.id,
        status: IntentStatus.COMPLETED,
      }),
    )
  })

  it('onConfirmedIntent should use intent.pricePerMB, not current config', async () => {
    // Set current config to a different value than the intent's stored price
    config.paymentManager.pricePerMB = 99
    const storedPrice = 2
    // Choose deposit so that credits = 123 when divided by storedPrice
    const depositAmount = 123n * BigInt(storedPrice) * 10n ** 12n
    const intent: Intent = {
      id: '0x8',
      userPublicId: user.publicId,
      status: IntentStatus.CONFIRMED,
      expiresAt: new Date(Date.now() + 1000),
      depositAmount,
      pricePerMB: storedPrice,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    const addCreditsSpy = jest
      .spyOn(SubscriptionsUseCases, 'addCreditsToSubscription')
      .mockResolvedValue(ok())
    const updateSpy = jest
      .spyOn(intentsRepository, 'updateIntent')
      .mockResolvedValue({ ...intent, status: IntentStatus.COMPLETED })

    const res = await IntentsUseCases.onConfirmedIntent(intent.id)

    expect(res.isOk()).toBe(true)
    // Must compute with intent.pricePerMB (2), not config (99)
    expect(addCreditsSpy).toHaveBeenCalledWith(user.publicId, 123)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: intent.id,
        status: IntentStatus.COMPLETED,
      }),
    )
  })

  it('onConfirmedIntent should error when already completed', async () => {
    const intent: Intent = {
      id: '0x6',
      userPublicId: user.publicId,
      status: IntentStatus.COMPLETED,
      expiresAt: new Date(Date.now() + 1000),
      depositAmount: 1n,
      pricePerMB: 1,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)

    const res = await IntentsUseCases.onConfirmedIntent(intent.id)
    expect(res.isErr()).toBe(true)
  })

  it('getConfirmedIntents should proxy repository', async () => {
    const intents: Intent[] = [
      {
        id: '0x7',
        userPublicId: user.publicId,
        status: IntentStatus.CONFIRMED,
        expiresAt: new Date(Date.now() + 1000),
        pricePerMB: 1,
      },
    ]
    jest.spyOn(intentsRepository, 'getByStatus').mockResolvedValue(intents)
    const res = await IntentsUseCases.getConfirmedIntents()
    expect(res).toEqual(intents)
  })

  it('getPrice should return current price per MB', async () => {
    config.paymentManager.pricePerMB = 42
    const res = await IntentsUseCases.getPrice()
    expect(res.price).toBe(42)
  })
})
