import { OffchainMetadata } from "@autonomys/auto-drive";

export interface UploadedObjectMetadata {
  metadata: OffchainMetadata;
  uploadStatus: UploadStatus;
  owners: Owner[];
}

export interface UploadStatus {
  uploadedNodes: number;
  totalNodes: number;
  minimumBlockDepth: number | null;
  maximumBlockDepth: number | null;
}

export interface Owner {
  publicId: string;
  role: OwnerRole;
}

export enum OwnerRole {
  ADMIN = "admin",
  VIEWER = "viewer",
}
