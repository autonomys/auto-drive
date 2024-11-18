import { OffchainMetadata } from '@autonomys/auto-dag-data';

export interface UploadedObjectMetadata {
  metadata: OffchainMetadata;
  uploadStatus: UploadStatus;
  owners: Owner[];
}

export interface UploadStatus {
  uploadedNodes: number;
  totalNodes: number;
  archivedNodes: number | null;
  minimumBlockDepth: number | null;
  maximumBlockDepth: number | null;
}

export interface Owner {
  publicId: string;
  role: OwnerRole;
}

export enum OwnerRole {
  ADMIN = 'admin',
  VIEWER = 'viewer',
}

export type ObjectSummary = {
  headCid: string;
  name?: string;
  size: number;
  owners: Owner[];
  uploadStatus: UploadStatus;
} & (
  | {
      type: 'file';
      mimeType?: string;
    }
  | {
      type: 'folder';
      children: (OffchainMetadata & { type: 'folder' })['children'];
    }
);
