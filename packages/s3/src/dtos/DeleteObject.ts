export interface DeleteObjectCommandParams {
  Bucket: string;
  Key: string;
}

/** DeleteObject returns no body (S3 responds 204 No Content). */
export type DeleteObjectCommandResult = Record<string, never>;
