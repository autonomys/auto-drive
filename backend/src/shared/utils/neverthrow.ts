import { InternalError } from '../../errors/index.js'
import { err, fromPromise, ok, Result, ResultAsync } from 'neverthrow'

export const handleInternalError = <T>(
  result: Promise<T>,
  errorMessage: string,
): ResultAsync<T, InternalError> => {
  return fromPromise(
    result,
    (e) =>
      new InternalError(
        `${errorMessage}: ${e instanceof Error ? e.message : String(e)}`,
      ),
  )
}

export const handleInternalErrorResult = <T, E>(
  result: Promise<Result<T, E>>,
  errorMessage: string,
): ResultAsync<T, InternalError | E> => {
  return fromPromise(
    result,
    (e) =>
      new InternalError(
        `${errorMessage}: ${e instanceof Error ? e.message : String(e)}`,
      ),
  ).andThen((e) => {
    if (e.isErr()) {
      return err(e.error)
    }
    return ok(e.value)
  })
}
