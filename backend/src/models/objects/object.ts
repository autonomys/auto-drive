import { OffchainMetadata } from "@autonomys/auto-drive";

export interface ObjectInformation {
  cid: string;
  metadata: OffchainMetadata;
  uploadStatus: UploadStatus;
  owners: Owner[];
}

export interface UploadStatus {
  uploadedNodes: number | null;
  totalNodes: number | null;
  minimumBlockDepth: number | null;
  maximumBlockDepth: number | null;
}

export interface Owner {
  handle: string;
  role: OwnerRole;
}

export enum OwnerRole {
  ADMIN = "admin",
  VIEWER = "viewer",
}

export type ObjectSearchResult = {
  cid: string;
  name: string;
};
