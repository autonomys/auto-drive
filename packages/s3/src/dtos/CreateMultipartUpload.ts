export interface CreateMultipartUploadCommandParams {
  Bucket: string;
  Key: string;
  ContentType?: string;
}

export interface CreateMultipartUploadCommandResult {
  UploadId: string;
  Bucket: string;
  Key: string;
}
