import { jest } from '@jest/globals'
import { IntentsUseCases } from '../../../src/core/users/intents.js'
import { intentsRepository } from '../../../src/infrastructure/repositories/users/intents.js'
import { EventRouter } from '../../../src/infrastructure/eventRouter/index.js'
import { AccountsUseCases } from '../../../src/core/users/accounts.js'
import { ConflictError, ForbiddenError, GoneError } from '../../../src/errors/index.js'
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
    jest.spyOn(IntentsUseCases, 'getPrice').mockResolvedValue({ price: 1, pricePerGB: 1073741824 })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  // ────────────────────────────────────────────────────────────────────────────
  // createIntent
  // ────────────────────────────────────────────────────────────────────────────

  it('createIntent should create PENDING intent for user', async () => {
    jest
      .spyOn(intentsRepository, 'createIntent')
      .mockImplementation(async (intent) => intent)

    const intent = await IntentsUseCases.createIntent(user)

    expect(intent.userPublicId).toBe(user.publicId)
    expect(intent.status).toBe(IntentStatus.PENDING)
    expect(intent.shannonsPerByte).toBe(1n)
  })

  it('createIntent should set expiresAt in the future', async () => {
    jest
      .spyOn(intentsRepository, 'createIntent')
      .mockImplementation(async (intent) => intent)

    const before = new Date()
    const intent = await IntentsUseCases.createIntent(user)
    const after = new Date()

    expect(intent.expiresAt).toBeDefined()
    expect(intent.expiresAt!.getTime()).toBeGreaterThan(before.getTime())
    // expiresAt should be at least 1 minute ahead (config default is 10 min)
    expect(intent.expiresAt!.getTime()).toBeGreaterThan(
      before.getTime() + 60 * 1000,
    )
    expect(intent.expiresAt!.getTime()).toBeLessThan(
      after.getTime() + 15 * 60 * 1000,
    )
  })

  // ────────────────────────────────────────────────────────────────────────────
  // getIntent
  // ────────────────────────────────────────────────────────────────────────────

  it('getIntent should return ok when found', async () => {
    const intent: Intent = {
      id: '0x1',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
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

  it('getIntent should return GoneError when intent is expired', async () => {
    const expired: Intent = {
      id: '0x1e',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
      expiresAt: new Date(Date.now() - 1000), // 1 second in the past
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(expired)

    const result = await IntentsUseCases.getIntent(user, expired.id)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(GoneError)
  })

  it('getIntent should return ok when expiresAt is in the future', async () => {
    const active: Intent = {
      id: '0x1f',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 min ahead
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(active)

    const result = await IntentsUseCases.getIntent(user, active.id)
    expect(result.isOk()).toBe(true)
  })

  it('getIntent should treat missing expiresAt as expired (legacy rows)', async () => {
    const legacy: Intent = {
      id: '0x1l',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
      // no expiresAt — pre-feature row, must be treated as expired
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(legacy)

    const result = await IntentsUseCases.getIntent(user, legacy.id)
    expect(result.isOk()).toBe(false)
  })

  it('getIntent should return ok for PENDING intent with txHash even if expiresAt is past', async () => {
    const watched: Intent = {
      id: '0x1w',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
      txHash: '0xsubmitted',
      expiresAt: new Date(Date.now() - 60 * 1000), // 1 min in the past
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(watched)

    const result = await IntentsUseCases.getIntent(user, watched.id)
    expect(result.isOk()).toBe(true)
  })

  it('getIntent should return ok for CONFIRMED intent even if expiresAt is past', async () => {
    const confirmed: Intent = {
      id: '0x1c',
      userPublicId: user.publicId,
      status: IntentStatus.CONFIRMED,
      shannonsPerByte: 1n,
      expiresAt: new Date(Date.now() - 60 * 1000),
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(confirmed)

    const result = await IntentsUseCases.getIntent(user, confirmed.id)
    expect(result.isOk()).toBe(true)
  })

  it('getIntent should return ok for COMPLETED intent even if expiresAt is past', async () => {
    const completed: Intent = {
      id: '0x1d',
      userPublicId: user.publicId,
      status: IntentStatus.COMPLETED,
      shannonsPerByte: 1n,
      expiresAt: new Date(Date.now() - 60 * 1000),
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(completed)

    const result = await IntentsUseCases.getIntent(user, completed.id)
    expect(result.isOk()).toBe(true)
  })

  it('getIntent should return GoneError when intent status is EXPIRED', async () => {
    const expired: Intent = {
      id: '0x1x',
      userPublicId: user.publicId,
      status: IntentStatus.EXPIRED,
      shannonsPerByte: 1n,
      expiresAt: new Date(Date.now() - 1000),
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(expired)

    const result = await IntentsUseCases.getIntent(user, expired.id)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(GoneError)
  })

  it('getIntent should error with forbidden when user does not match', async () => {
    const intent: Intent = {
      id: '0x9',
      userPublicId: 'different-user',
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)

    const result = await IntentsUseCases.getIntent(user, intent.id)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
  })

  // ────────────────────────────────────────────────────────────────────────────
  // triggerWatchIntent
  // ────────────────────────────────────────────────────────────────────────────

  it('triggerWatchIntent should publish event and set txHash when user matches', async () => {
    const intent: Intent = {
      id: '0x2',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
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

  it('triggerWatchIntent should return GoneError when intent is expired', async () => {
    const expired: Intent = {
      id: '0x2e',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
      expiresAt: new Date(Date.now() - 1000), // already past
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(expired)

    const res = await IntentsUseCases.triggerWatchIntent({
      executor: user,
      txHash: '0xhash',
      intentId: expired.id,
    })

    expect(res.isErr()).toBe(true)
    expect(res._unsafeUnwrapErr()).toBeInstanceOf(GoneError)
  })

  it('triggerWatchIntent should error when intent not found', async () => {
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(null)

    const res = await IntentsUseCases.triggerWatchIntent({
      executor: user,
      txHash: '0xhash',
      intentId: '0xnotfound',
    })

    expect(res.isErr()).toBe(true)
  })

  // ────────────────────────────────────────────────────────────────────────────
  // markIntentAsConfirmed
  // ────────────────────────────────────────────────────────────────────────────

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

  it('markIntentAsConfirmed should error when intent not found', async () => {
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(null)

    const res = await IntentsUseCases.markIntentAsConfirmed({
      intentId: '0xnotfound',
      paymentAmount: 100n,
    })

    expect(res.isErr()).toBe(true)
  })

  // ────────────────────────────────────────────────────────────────────────────
  // onConfirmedIntent
  // ────────────────────────────────────────────────────────────────────────────

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

    // getIntentCredits now returns bigint; intentId is forwarded as third arg.
    const credits = paymentAmount / intent.shannonsPerByte

    expect(res.isOk()).toBe(true)
    expect(addCreditsSpy).toHaveBeenCalledWith(user.publicId, credits, intent.id)
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
    // getIntentCredits now returns bigint; intentId is forwarded as third arg.
    const credits = paymentAmount / intent.shannonsPerByte
    expect(addCreditsSpy).toHaveBeenCalledWith(user.publicId, credits, intent.id)
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

  it('onConfirmedIntent should error when intent not found', async () => {
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(null)

    const res = await IntentsUseCases.onConfirmedIntent('0xnotfound')
    expect(res.isErr()).toBe(true)
  })

  it('onConfirmedIntent should error when payment amount is missing', async () => {
    const intent: Intent = {
      id: '0x10',
      userPublicId: user.publicId,
      status: IntentStatus.CONFIRMED,
      paymentAmount: undefined,
      shannonsPerByte: 1n,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)

    const res = await IntentsUseCases.onConfirmedIntent(intent.id)

    expect(res.isErr()).toBe(true)
  })

  it('onConfirmedIntent should mark OVER_CAP (not retry) when cap is exceeded', async () => {
    const intent: Intent = {
      id: '0x11',
      userPublicId: user.publicId,
      status: IntentStatus.CONFIRMED,
      paymentAmount: 100n,
      shannonsPerByte: 1n,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    const { err: neverthrowErr } = await import('neverthrow')
    jest
      .spyOn(AccountsUseCases, 'addCreditsToAccount')
      .mockResolvedValue(
        neverthrowErr(new ForbiddenError('Purchase would exceed per-user credit cap')),
      )
    const updateSpy = jest
      .spyOn(intentsRepository, 'updateIntent')
      .mockResolvedValue({ ...intent, status: IntentStatus.OVER_CAP })

    const res = await IntentsUseCases.onConfirmedIntent(intent.id)

    // Must succeed (not error) so the polling loop stops retrying
    expect(res.isOk()).toBe(true)
    // Intent must be marked OVER_CAP, not COMPLETED or left as CONFIRMED
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: intent.id, status: IntentStatus.OVER_CAP }),
    )
  })

  it('onConfirmedIntent should NOT mark COMPLETED when capped — update must use OVER_CAP status', async () => {
    const intent: Intent = {
      id: '0x11c',
      userPublicId: user.publicId,
      status: IntentStatus.CONFIRMED,
      paymentAmount: 500n,
      shannonsPerByte: 1n,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)
    const { err: neverthrowErr } = await import('neverthrow')
    jest
      .spyOn(AccountsUseCases, 'addCreditsToAccount')
      .mockResolvedValue(neverthrowErr(new ForbiddenError('cap')))
    const updateSpy = jest
      .spyOn(intentsRepository, 'updateIntent')
      .mockResolvedValue({ ...intent, status: IntentStatus.OVER_CAP })

    await IntentsUseCases.onConfirmedIntent(intent.id)

    // Verify status is specifically OVER_CAP, not COMPLETED
    expect(updateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: IntentStatus.COMPLETED }),
    )
  })

  // ────────────────────────────────────────────────────────────────────────────
  // cleanupExpiredIntents
  // ────────────────────────────────────────────────────────────────────────────

  it('cleanupExpiredIntents should call expireIntentIfPending for each expired intent', async () => {
    const expiredIntent: Intent = {
      id: '0xexp1',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
      expiresAt: new Date(Date.now() - 5000),
    }
    jest
      .spyOn(intentsRepository, 'getExpiredPendingIntents')
      .mockResolvedValue([expiredIntent])
    const expireSpy = jest
      .spyOn(intentsRepository, 'expireIntentIfPending')
      .mockResolvedValue(true)

    await IntentsUseCases.cleanupExpiredIntents()

    expect(expireSpy).toHaveBeenCalledWith(expiredIntent.id)
  })

  it('cleanupExpiredIntents should do nothing when no expired intents', async () => {
    jest
      .spyOn(intentsRepository, 'getExpiredPendingIntents')
      .mockResolvedValue([])
    const expireSpy = jest.spyOn(intentsRepository, 'expireIntentIfPending')

    await IntentsUseCases.cleanupExpiredIntents()

    expect(expireSpy).not.toHaveBeenCalled()
  })

  it('cleanupExpiredIntents should handle multiple expired intents', async () => {
    const expiredIntents: Intent[] = [
      {
        id: '0xexp2',
        userPublicId: user.publicId,
        status: IntentStatus.PENDING,
        shannonsPerByte: 1n,
        expiresAt: new Date(Date.now() - 1000),
      },
      {
        id: '0xexp3',
        userPublicId: user.publicId,
        status: IntentStatus.PENDING,
        shannonsPerByte: 1n,
        expiresAt: new Date(Date.now() - 2000),
      },
    ]
    jest
      .spyOn(intentsRepository, 'getExpiredPendingIntents')
      .mockResolvedValue(expiredIntents)
    const expireSpy = jest
      .spyOn(intentsRepository, 'expireIntentIfPending')
      .mockResolvedValue(true)

    await IntentsUseCases.cleanupExpiredIntents()

    expect(expireSpy).toHaveBeenCalledTimes(2)
    expect(expireSpy).toHaveBeenCalledWith('0xexp2')
    expect(expireSpy).toHaveBeenCalledWith('0xexp3')
  })

  it('cleanupExpiredIntents should tolerate concurrent status changes (no-op on already-confirmed)', async () => {
    const expiredIntents: Intent[] = [
      {
        id: '0xexp4',
        userPublicId: user.publicId,
        status: IntentStatus.PENDING,
        shannonsPerByte: 1n,
        expiresAt: new Date(Date.now() - 1000),
      },
      {
        id: '0xexp5',
        userPublicId: user.publicId,
        status: IntentStatus.PENDING,
        shannonsPerByte: 1n,
        expiresAt: new Date(Date.now() - 2000),
      },
    ]
    jest
      .spyOn(intentsRepository, 'getExpiredPendingIntents')
      .mockResolvedValue(expiredIntents)
    const expireSpy = jest
      .spyOn(intentsRepository, 'expireIntentIfPending')
      .mockResolvedValueOnce(true) // first intent expired normally
      .mockResolvedValueOnce(false) // second was confirmed concurrently

    await IntentsUseCases.cleanupExpiredIntents()

    expect(expireSpy).toHaveBeenCalledTimes(2)
  })

  // ────────────────────────────────────────────────────────────────────────────
  // Miscellaneous
  // ────────────────────────────────────────────────────────────────────────────

  // ────────────────────────────────────────────────────────────────────────────
  // getOverCapIntents
  // ────────────────────────────────────────────────────────────────────────────

  it('getOverCapIntents should return intents for admin users', async () => {
    const admin = { ...user, role: 'admin' } as unknown as User
    const overCapIntent: Intent = {
      id: '0xoc1',
      userPublicId: user.publicId,
      status: IntentStatus.OVER_CAP,
      paymentAmount: 100n,
      shannonsPerByte: 1n,
    }
    jest
      .spyOn(intentsRepository, 'getOverCapIntents')
      .mockResolvedValue([overCapIntent])

    const result = await IntentsUseCases.getOverCapIntents(admin)

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual([overCapIntent])
  })

  it('getOverCapIntents should return ForbiddenError for non-admin users', async () => {
    const nonAdmin = { ...user, role: 'user' } as unknown as User
    const repoSpy = jest.spyOn(intentsRepository, 'getOverCapIntents')

    const result = await IntentsUseCases.getOverCapIntents(nonAdmin)

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
    // Repository must not be called — admin check happens first
    expect(repoSpy).not.toHaveBeenCalled()
  })

  it('getOverCapIntents should return empty array when no capped intents exist', async () => {
    const admin = { ...user, role: 'admin' } as unknown as User
    jest.spyOn(intentsRepository, 'getOverCapIntents').mockResolvedValue([])

    const result = await IntentsUseCases.getOverCapIntents(admin)

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual([])
  })

  // ────────────────────────────────────────────────────────────────────────────
  // reprocessOverCapIntent
  // ────────────────────────────────────────────────────────────────────────────

  it('reprocessOverCapIntent should reset OVER_CAP intent to CONFIRMED', async () => {
    const admin = { ...user, role: 'admin' } as unknown as User
    const overCapIntent: Intent = {
      id: '0xrp1',
      userPublicId: user.publicId,
      status: IntentStatus.OVER_CAP,
      paymentAmount: 100n,
      shannonsPerByte: 1n,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(overCapIntent)
    const updateSpy = jest
      .spyOn(intentsRepository, 'updateIntent')
      .mockResolvedValue({ ...overCapIntent, status: IntentStatus.CONFIRMED })

    const result = await IntentsUseCases.reprocessOverCapIntent(admin, overCapIntent.id)

    expect(result.isOk()).toBe(true)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: overCapIntent.id,
        status: IntentStatus.CONFIRMED,
      }),
    )
  })

  it('reprocessOverCapIntent should return ForbiddenError for non-admin', async () => {
    const nonAdmin = { ...user, role: 'user' } as unknown as User
    const repoSpy = jest.spyOn(intentsRepository, 'getById')

    const result = await IntentsUseCases.reprocessOverCapIntent(nonAdmin, '0xrp2')

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
    expect(repoSpy).not.toHaveBeenCalled()
  })

  it('reprocessOverCapIntent should return ObjectNotFoundError when intent missing', async () => {
    const admin = { ...user, role: 'admin' } as unknown as User
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(null)

    const result = await IntentsUseCases.reprocessOverCapIntent(admin, '0xrp3')

    expect(result.isErr()).toBe(true)
  })

  it('reprocessOverCapIntent should return ConflictError when intent is not OVER_CAP', async () => {
    const admin = { ...user, role: 'admin' } as unknown as User
    const completedIntent: Intent = {
      id: '0xrp4',
      userPublicId: user.publicId,
      status: IntentStatus.COMPLETED,
      paymentAmount: 100n,
      shannonsPerByte: 1n,
    }
    jest.spyOn(intentsRepository, 'getById').mockResolvedValue(completedIntent)
    const updateSpy = jest.spyOn(intentsRepository, 'updateIntent')

    const result = await IntentsUseCases.reprocessOverCapIntent(admin, completedIntent.id)

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)
    // Must not attempt to update an intent that isn't OVER_CAP
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('reprocessOverCapIntent should return ConflictError for PENDING, CONFIRMED, EXPIRED statuses', async () => {
    const admin = { ...user, role: 'admin' } as unknown as User
    const statuses = [IntentStatus.PENDING, IntentStatus.CONFIRMED, IntentStatus.EXPIRED]

    for (const status of statuses) {
      const intent: Intent = {
        id: `0xrp-${status}`,
        userPublicId: user.publicId,
        status,
        shannonsPerByte: 1n,
      }
      jest.spyOn(intentsRepository, 'getById').mockResolvedValue(intent)

      const result = await IntentsUseCases.reprocessOverCapIntent(admin, intent.id)

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ConflictError)
    }
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

  it('getIntentCredits should calculate credits correctly', () => {
    const intent: Intent = {
      id: '0x12',
      userPublicId: user.publicId,
      status: IntentStatus.CONFIRMED,
      paymentAmount: 1000n,
      shannonsPerByte: 10n,
    }

    const credits = IntentsUseCases.getIntentCredits(intent)
    expect(credits).toBe(100n)
  })

  it('getIntentCredits should return 0n when paymentAmount is undefined', () => {
    const intent: Intent = {
      id: '0x13',
      userPublicId: user.publicId,
      status: IntentStatus.CONFIRMED,
      paymentAmount: undefined,
      shannonsPerByte: 10n,
    }

    const credits = IntentsUseCases.getIntentCredits(intent)
    expect(credits).toBe(0n)
  })

  it('updateIntent should proxy repository', async () => {
    const intent: Intent = {
      id: '0x14',
      userPublicId: user.publicId,
      status: IntentStatus.PENDING,
      shannonsPerByte: 1n,
    }
    const updateSpy = jest
      .spyOn(intentsRepository, 'updateIntent')
      .mockResolvedValue(intent)

    const result = await IntentsUseCases.updateIntent(intent)

    expect(updateSpy).toHaveBeenCalledWith(intent)
    expect(result).toEqual(intent)
  })
})
