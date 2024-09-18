import { OffchainMetadata } from "@autonomys/auto-drive";

export interface UploadedObjectMetadata {
  metadata: OffchainMetadata;
  uploadStatus: { nodesToBeUploaded: number; uploadedNodes: number };
}
