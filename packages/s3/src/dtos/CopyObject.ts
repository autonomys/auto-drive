export interface CopyObjectCommandParams {
  Bucket: string;
  Key: string;
  /**
   * Raw value of the x-amz-copy-source header identifying the source object:
   * "/{sourceBucket}/{sourceKey}" (may be URL-encoded and may carry a
   * "?versionId=" suffix, both of which the server normalizes away).
   */
  CopySource: string;
}

export interface CopyObjectCommandResult {
  ETag: string;
  /** ISO-8601 timestamp for the <CopyObjectResult><LastModified> body field. */
  LastModified: string;
}
