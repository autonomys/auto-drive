import { OffchainMetadata } from "@autonomys/auto-drive";

export interface UploadedObjectMetadata {
  metadata: OffchainMetadata;
  uploadStatus: UploadStatus;
}

export interface UploadStatus {
  nodesToBeUploaded: number;
  uploadedNodes: number;
}
