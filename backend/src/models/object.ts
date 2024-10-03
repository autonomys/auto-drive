import { OffchainMetadata } from "@autonomys/auto-drive";

export interface ObjectInformation {
  cid: string;
  metadata: OffchainMetadata;
  uploadStatus: UploadStatus;
}

export interface UploadStatus {
  uploadedNodes: number;
  totalNodes: number;
  minimumBlockDepth: number | null;
}
