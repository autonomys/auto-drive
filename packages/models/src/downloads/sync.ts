import { ByteRange } from "@autonomys/file-server";

export interface DownloadOptions extends DownloadServiceOptions {
  blockingTags?: string[];
}

export interface DownloadServiceOptions {
  byteRange?: ByteRange;
}
