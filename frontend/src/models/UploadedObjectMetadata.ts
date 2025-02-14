import { OffchainMetadata } from '@autonomys/auto-dag-data';

export interface UploadedObjectMetadata {
  metadata: OffchainMetadata;
  uploadStatus: UploadStatus;
  owners: Owner[];
  publishedObjectId: string | null;
}

export interface BaseMetadata {
  cid: string;
  name?: string;
  size?: number;
  type: 'file' | 'folder';
}

export interface UploadStatus {
  uploadedNodes: number;
  totalNodes: number;
  archivedNodes: number | null;
  minimumBlockDepth: number | null;
  maximumBlockDepth: number | null;
}

export interface Owner {
  oauthProvider: string;
  oauthUserId: string;
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
  publishedObjectId: string | null;
  createdAt: string | null;
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
