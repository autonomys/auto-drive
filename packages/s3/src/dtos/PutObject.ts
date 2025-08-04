import { UploadOptions } from "@auto-drive/models";
import { Readable } from "stream";

export interface PutObjectCommandParams {
  Bucket: string;
  Key: string;
  Body: Buffer;
  ContentType?: string;
  UploadOptions?: UploadOptions;
}

export interface PutObjectCommandResult {
  ETag: string;
}
