export enum AsyncDownloadStatus {
  Pending = "pending",
  Downloading = "downloading",
  Completed = "completed",
  Failed = "failed",
  Dismissed = "dismissed",
}

export interface AsyncDownload {
  id: string;
  oauthProvider: string;
  oauthUserId: string;
  cid: string;
  status: string;
  errorMessage: string | null;
  fileSize: bigint | null;
  downloadedBytes: bigint;
  createdAt: Date;
  updatedAt: Date;
}
