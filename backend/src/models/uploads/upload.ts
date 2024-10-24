import { z } from "zod";
import { FolderTreeSchema } from "../objects/index.js";

export enum UploadType {
  FILE = "file",
  FOLDER = "folder",
}

export enum UploadStatus {
  PENDING = "pending",
  COMPLETED = "completed",
  CANCELLED = "cancelled",
  FAILED = "failed",
}

export const fileUploadSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
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

export const folderUploadSchema = z.object({
  id: z.string(),
  parentId: z.null(),
  relativeId: z.null(),
  type: z.nativeEnum(UploadType),
  status: z.nativeEnum(UploadStatus),
  fileTree: FolderTreeSchema,
  name: z.string(),
  mimeType: z.null(),
  oauthProvider: z.string(),
  oauthUserId: z.string(),
});

export type FolderUpload = z.infer<typeof folderUploadSchema>;

export type Upload = FileUpload | FolderUpload;
