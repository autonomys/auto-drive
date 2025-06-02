import { OffchainMetadata } from "@autonomys/auto-dag-data";
import { Readable } from "stream";

export interface ObjectInformation {
  cid: string;
  createdAt: string;
  metadata: OffchainMetadata;
  status: ObjectStatus;
  uploadState: ObjectUploadState;
  owners: Owner[];
  publishedObjectId: string | null;
  tags: string[];
}

export enum ObjectStatus {
  Processing = "Processing",
  Publishing = "Publishing",
  Archiving = "Archiving",
  Archived = "Archived",
}

export interface ObjectUploadState {
  uploadedNodes: number | null;
  totalNodes: number | null;
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
  ADMIN = "admin",
  VIEWER = "viewer",
}

export type ObjectSearchResult = {
  cid: string;
  name: string;
};

export type ObjectSummary = {
  headCid: string;
  tags: string[];
  name?: string;
  size: string;
  status: ObjectStatus;
  owners: Owner[];
  uploadState: ObjectUploadState;
  createdAt: string;
} & (
  | {
      type: "file";
      mimeType?: string;
    }
  | {
      type: "folder";
      children: (OffchainMetadata & {
        type: "folder";
      })["children"];
    }
);

export const objectStatus = (uploadState: ObjectUploadState) => {
  if (uploadState.archivedNodes === uploadState.totalNodes) {
    return ObjectStatus.Archived;
  }

  if (uploadState.uploadedNodes === uploadState.totalNodes) {
    return ObjectStatus.Archiving;
  }

  if (uploadState.uploadedNodes === null || uploadState.uploadedNodes === 0) {
    return ObjectStatus.Processing;
  }

  return ObjectStatus.Publishing;
};

export const getObjectSummary = (object: ObjectInformation): ObjectSummary => {
  return object.metadata.type === "folder"
    ? {
        headCid: object.metadata.dataCid,
        name: object.metadata.name,
        type: object.metadata.type,
        size: object.metadata.totalSize.toString(),
        owners: object.owners,
        children: object.metadata.children,
        uploadState: object.uploadState,
        status: objectStatus(object.uploadState),
        createdAt: object.createdAt,
        tags: object.tags,
      }
    : {
        headCid: object.metadata.dataCid,
        name: object.metadata.name,
        type: object.metadata.type,
        size: object.metadata.totalSize.toString(),
        mimeType: object.metadata.mimeType,
        uploadState: object.uploadState,
        status: objectStatus(object.uploadState),
        owners: object.owners,
        createdAt: object.createdAt,
        tags: object.tags,
      };
};

export interface FileDownload {
  metadata: OffchainMetadata;
  startDownload: () => Promise<Readable> | Readable;
}
