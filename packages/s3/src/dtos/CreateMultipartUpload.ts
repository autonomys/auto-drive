import { UploadOptions } from "@auto-drive/models";

export interface CreateMultipartUploadCommandParams {
  Bucket: string;
  Key: string;
  ContentType?: string;
  UploadOptions?: UploadOptions;
}

export interface CreateMultipartUploadCommandResult {
  UploadId: string;
  Bucket: string;
  Key: string;
}
