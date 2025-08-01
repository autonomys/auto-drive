import { Readable } from "stream";

export interface PutObjectCommandParams {
  Bucket: string;
  Key: string;
  Body: Buffer;
  ContentType?: string;
}

export interface PutObjectCommandResult {
  ETag: string;
}
