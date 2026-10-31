import { HttpError, InternalError } from '../../errors/index.js'
import { err, fromPromise, ok, Result, ResultAsync } from 'neverthrow'

const toHttpError =
  (errorMessage: string) =>
  (e: unknown): HttpError =>
    e instanceof HttpError
      ? e
      : new InternalError(
          `${errorMessage}: ${e instanceof Error ? e.message : String(e)}`,
        )

export const handleInternalError = <T>(
  result: Promise<T>,
  errorMessage: string,
): ResultAsync<T, HttpError> => {
  return fromPromise(result, toHttpError(errorMessage))
}

export const handleInternalErrorResult = <T, E>(
  result: Promise<Result<T, E>>,
  errorMessage: string,
): ResultAsync<T, HttpError | E> => {
  return fromPromise(result, toHttpError(errorMessage)).andThen((e) => {
    if (e.isErr()) {
      return err(e.error)
    }
    return ok(e.value)
  })
}
