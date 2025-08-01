export interface CompleteMultipartUploadCommandParams {
  Bucket: string;
  Key: string;
  UploadId: string;
}

export interface CompleteMultipartUploadCommandResult {
  Location: string;
  Bucket: string;
  Key: string;
  ETag: string;
}
