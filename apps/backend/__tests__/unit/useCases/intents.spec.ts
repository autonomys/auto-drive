import { jest } from '@jest/globals'
import { IntentsUseCases } from '../../../src/core/users/intents.js'
import { intentsRepository } from '../../../src/infrastructure/repositories/users/intents.js'
import { EventRouter } from '../../../src/infrastructure/eventRouter/index.js'
import { AccountsUseCases } from '../../../src/core/users/accounts.js'
import { ForbiddenError } from '../../../src/errors/index.js'
import { IntentStatus, type Intent, type User } from '@auto-drive/models'
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
    jest.spyOn(IntentsUseCases, 'getPrice').mockResolvedValue({ price: 1 })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('createIntent should create PENDING intent for user', async () => {
    jest
      .spyOn(intentsRepository, 'createIntent')
      .mockImplementation(async (intent) => intent)

    const intent = await IntentsUseCases.createIntent(user)

    expect(intent.userPublicId).toBe(user.publicId)
    expect(intent.status).toBe(IntentStatus.PENDING)
    expect(intent.shannonsPerByte).toBe(1n)
  })

  it('getIntent should return ok when found', async () => {
    const intent: Intent = {
      id: '0x1',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)

    const result = await IntentsUseCases.getIntent(user, intent.id)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().id).toBe(intent.id)
  })

  it('getIntent should error when not found', async () => {
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(null)
    const result = await IntentsUseCases.getIntent(user, '0xnope')
    expect(result.isErr()).toBe(true)
  })

  it('triggerWatchIntent should publish event and set txHash when user matches', async () => {
    const intent: Intent = {
      id: '0x2',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
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
      shannonsPerByte: 1n,
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
      shannonsPerByte: 1n,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    const updateSpy = jest
      .spyOn(intentsRepository, 'updateIntent')
      .mockResolvedValue({
        ...intent,
        status: IntentStatus.CONFIRMED,
        paymentAmount: 10n,
      })

    const res = await IntentsUseCases.markIntentAsConfirmed({
      intentId: intent.id,
      paymentAmount: 10n,
    })

    expect(res.isOk()).toBe(true)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: intent.id,
        status: IntentStatus.CONFIRMED,
        paymentAmount: 10n,
      }),
    )
  })

  it('onConfirmedIntent should add credits and complete intent', async () => {
    const paymentAmount = 123n * 10n ** 12n // yields 123 credits when pricePerMB=1
    const intent: Intent = {
      id: '0x5',
      userPublicId: user.publicId,
      status: IntentStatus.CONFIRMED,
      paymentAmount,
      shannonsPerByte: 1n,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    const addCreditsSpy = jest
      .spyOn(AccountsUseCases, 'addCreditsToAccount')
      .mockResolvedValue(ok())
    const updateSpy = jest
      .spyOn(intentsRepository, 'updateIntent')
      .mockResolvedValue({ ...intent, status: IntentStatus.COMPLETED })

    const res = await IntentsUseCases.onConfirmedIntent(intent.id)

    const credits = Number(paymentAmount / intent.shannonsPerByte)

    expect(res.isOk()).toBe(true)
    expect(addCreditsSpy).toHaveBeenCalledWith(user.publicId, credits)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: intent.id,
        status: IntentStatus.COMPLETED,
      }),
    )
  })

  it('onConfirmedIntent should use intent.pricePerMB, not current config', async () => {
    const storedPrice = 2n
    // Choose deposit so that credits = 123 when divided by storedPrice
    const paymentAmount = 123n * BigInt(storedPrice) * 10n ** 12n
    const intent: Intent = {
      id: '0x8',
      userPublicId: user.publicId,
      status: IntentStatus.CONFIRMED,
      paymentAmount,
      shannonsPerByte: storedPrice,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    const addCreditsSpy = jest
      .spyOn(AccountsUseCases, 'addCreditsToAccount')
      .mockResolvedValue(ok())
    const updateSpy = jest
      .spyOn(intentsRepository, 'updateIntent')
      .mockResolvedValue({ ...intent, status: IntentStatus.COMPLETED })

    const res = await IntentsUseCases.onConfirmedIntent(intent.id)

    expect(res.isOk()).toBe(true)
    const credits = Number(paymentAmount / intent.shannonsPerByte)
    expect(addCreditsSpy).toHaveBeenCalledWith(user.publicId, credits)
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
      paymentAmount: 1n,
      shannonsPerByte: 1n,
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
        shannonsPerByte: 1n,
      },
    ]
    jest.spyOn(intentsRepository, 'getByStatus').mockResolvedValue(intents)
    const res = await IntentsUseCases.getConfirmedIntents()
    expect(res).toEqual(intents)
  })
})
