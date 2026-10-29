import {
  BadRequestError,
  InternalError,
  PaymentRequiredError,
} from '../../../src/errors/index.js'
import {
  handleInternalError,
  handleInternalErrorResult,
} from '../../../src/shared/utils/neverthrow.js'
import { err } from 'neverthrow'

describe('handleInternalError', () => {
  it('passes a thrown HttpError through unchanged', async () => {
    const thrown = new PaymentRequiredError('Insufficient credits')

    const result = await handleInternalError(
      Promise.reject(thrown),
      'Failed to complete upload',
    )

    expect(result._unsafeUnwrapErr()).toBe(thrown)
  })

  it('wraps any other throw in an InternalError carrying its message', async () => {
    const result = await handleInternalError(
      Promise.reject(new Error('connection reset')),
      'Failed to complete upload',
    )

    const error = result._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(InternalError)
    expect(error.message).toBe('Failed to complete upload: connection reset')
  })
})

describe('handleInternalErrorResult', () => {
  it('passes a thrown HttpError through unchanged', async () => {
    const thrown = new BadRequestError('Bad part')

    const result = await handleInternalErrorResult(
      Promise.reject(thrown),
      'Failed to get stats',
    )

    expect(result._unsafeUnwrapErr()).toBe(thrown)
  })

  it('still returns the Err of a resolved Result', async () => {
    const returned = new BadRequestError('Bad input')

    const result = await handleInternalErrorResult(
      Promise.resolve(err(returned)),
      'Failed to get stats',
    )

    expect(result._unsafeUnwrapErr()).toBe(returned)
  })

  it('wraps any other throw in an InternalError carrying its message', async () => {
    const result = await handleInternalErrorResult(
      Promise.reject('boom'),
      'Failed to get stats',
    )

    const error = result._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(InternalError)
    expect(error).toHaveProperty('message', 'Failed to get stats: boom')
  })
})
