import { ByteRange } from "@autonomys/file-caching";
import { FileDownload } from "@auto-drive/models";

export interface GetObjectCommandParams {
  Bucket: string;
  Key: string;
  Range?: ByteRange;
}

export type GetObjectCommandResult = FileDownload;
