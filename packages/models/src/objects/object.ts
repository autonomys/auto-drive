import { OffchainMetadata } from "@autonomys/auto-dag-data";
import { AwaitIterable } from "interface-store";

export interface ObjectInformation {
  cid: string;
  createdAt: string;
  metadata: OffchainMetadata;
  uploadStatus: ObjectUploadStatus;
  owners: Owner[];
  publishedObjectId: string | null;
}

export interface ObjectUploadStatus {
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
  name?: string;
  size: string;
  owners: Owner[];
  uploadStatus: ObjectUploadStatus;
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

export const getObjectSummary = (object: ObjectInformation): ObjectSummary => {
  return object.metadata.type === "folder"
    ? {
        headCid: object.metadata.dataCid,
        name: object.metadata.name,
        type: object.metadata.type,
        size: object.metadata.totalSize.toString(),
        owners: object.owners,
        children: object.metadata.children,
        uploadStatus: object.uploadStatus,
        createdAt: object.createdAt,
      }
    : {
        headCid: object.metadata.dataCid,
        name: object.metadata.name,
        type: object.metadata.type,
        size: object.metadata.totalSize.toString(),
        mimeType: object.metadata.mimeType,
        uploadStatus: object.uploadStatus,
        owners: object.owners,
        createdAt: object.createdAt,
      };
};

export interface FileDownload {
  metadata: OffchainMetadata;
  startDownload: () => Promise<AwaitIterable<Buffer>>;
}
