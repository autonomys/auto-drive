import { ByteRange } from "@autonomys/file-caching";

export interface DownloadOptions extends DownloadServiceOptions {
  blockingTags?: string[];
}

export interface DownloadServiceOptions {
  byteRange?: ByteRange;
}
