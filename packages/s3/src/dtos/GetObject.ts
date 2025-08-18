import { ByteRange } from "@autonomys/file-server";
import { FileDownload } from "@auto-drive/models";

export interface GetObjectCommandParams {
  Bucket: string;
  Key: string;
  Range?: ByteRange;
}

export type GetObjectCommandResult = FileDownload;
