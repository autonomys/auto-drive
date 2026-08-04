import { ConflictError } from '../../errors/index.js'

/**
 * Thrown when an upload can never be migrated, no matter how many times the
 * task is retried — the row's data shape itself is wrong (a root blockstore
 * node that is missing or ambiguous, or an upload row that no longer exists).
 *
 * This exists to separate "try again later" from "this will fail identically
 * forever". `migrate-upload-nodes` is retried three times and then published to
 * the unconsumed `frontend-errors` queue, while the migration recovery sweep
 * re-drives the still-MIGRATING row once per staleness window — so a
 * permanently broken upload emits a dead-letter message every window, without
 * bound, for as long as the row exists. processMigration catches this error,
 * parks the upload in FAILED so the sweep stops selecting it, and acks the task
 * instead of retrying.
 */
export class UnrecoverableUploadError extends Error {
  constructor(
    message: string,
    readonly uploadId: string,
  ) {
    super(message)
    this.name = 'UnrecoverableUploadError'
  }
}

/**
 * Thrown when completeUpload cannot take the completion claim because another
 * call holds it. Distinct from a generic bad request because it is TRANSIENT and
 * retryable: the same call will succeed once the winner finishes.
 *
 * The type exists so route handlers can say that to the client rather than
 * guessing from a message string. It matters most on the S3 route, where
 * CompleteMultipartUpload has no Result-based error path for it — an S3 client's
 * own timeout retry is exactly the case this guard defends against, and it
 * deserves a retryable XML error rather than an opaque one.
 *
 * 409 rather than 400: the request is well-formed, the resource is simply in the
 * wrong state for it right now.
 */
export class UploadCompletionInProgressError extends ConflictError {
  constructor(
    message: string,
    readonly uploadId: string,
  ) {
    super(message)
    this.name = 'UploadCompletionInProgressError'
  }
}
