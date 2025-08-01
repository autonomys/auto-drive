export interface UploadPartCommandParams {
  Bucket: string;
  Key: string;
  UploadId: string;
  PartNumber: number;
  Body: Buffer;
}

export interface UploadPartCommandResult {
  ETag: string;
}
