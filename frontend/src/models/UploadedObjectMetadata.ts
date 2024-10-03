import { OffchainMetadata } from "@autonomys/auto-drive";

export interface UploadedObjectMetadata {
  metadata: OffchainMetadata;
  uploadStatus: UploadStatus;
}

export interface UploadStatus {
  uploadedNodes: number;
  totalNodes: number;
  minimumBlockDepth: number | null;
}
