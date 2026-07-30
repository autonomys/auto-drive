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
