import { z } from "zod";
import { FolderTreeFolderSchema, FolderTreeSchema } from "../objects/index.js";
import { UploadEntry } from "../../repositories/uploads/uploads.js";
import {
  OffchainFileMetadata,
  OffchainFolderMetadata,
} from "@autonomys/auto-drive";

export enum UploadType {
  FILE = "file",
  FOLDER = "folder",
}

export enum UploadStatus {
  PENDING = "pending",
  COMPLETED = "completed",
  MIGRATING = "migrating",
  CANCELLED = "cancelled",
  FAILED = "failed",
}

export const fileUploadSchema = z.object({
  id: z.string(),
  rootId: z.string().nullable(),
  relativeId: z.string().nullable(),
  type: z.nativeEnum(UploadType),
  status: z.nativeEnum(UploadStatus),
  fileTree: z.null(),
  name: z.string(),
  mimeType: z.string().nullable(),
  oauthProvider: z.string(),
  oauthUserId: z.string(),
});

export type FileUpload = z.infer<typeof fileUploadSchema>;

export const mapModelToTable = (upload: Upload): UploadEntry => {
  return {
    id: upload.id,
    type: upload.type,
    status: upload.status,
    name: upload.name,
    file_tree: upload.fileTree,
    mime_type: upload.mimeType,
    root_upload_id: upload.rootId,
    relative_id: upload.relativeId,
    oauth_provider: upload.oauthProvider,
    oauth_user_id: upload.oauthUserId,
  };
};

export const folderUploadSchema = z.object({
  id: z.string(),
  rootId: z.null(),
  relativeId: z.null(),
  type: z.nativeEnum(UploadType),
  status: z.nativeEnum(UploadStatus),
  fileTree: FolderTreeFolderSchema,
  name: z.string(),
  mimeType: z.null(),
  oauthProvider: z.string(),
  oauthUserId: z.string(),
});

export type FolderUpload = z.infer<typeof folderUploadSchema>;

export type Upload = FileUpload | FolderUpload;

export type UploadArtifacts = FileArtifacts | FolderArtifacts;

export type FileArtifacts = {
  metadata: OffchainFileMetadata;
};

export type FolderArtifacts = {
  metadata: OffchainFolderMetadata;
  childrenArtifacts: UploadArtifacts[];
};
