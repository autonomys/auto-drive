import { z } from 'zod'
import { FolderTreeFolder, FolderTreeFolderSchema } from '../objects/index.js'
import {
  CompressionAlgorithm,
  EncryptionAlgorithm,
  FileUploadOptions,
  OffchainFileMetadata,
  OffchainFolderMetadata,
} from '@autonomys/auto-dag-data'

export enum UploadType {
  FILE = 'file',
  FOLDER = 'folder',
}

export enum UploadStatus {
  PENDING = 'pending',
  MIGRATING = 'migrating',
  CANCELLED = 'cancelled',
  FAILED = 'failed',
}

export type UploadEntry = {
  id: string;
  type: UploadType;
  status: UploadStatus;
  name: string;
  file_tree: FolderTreeFolder | null;
  mime_type: string | null;
  root_upload_id: string;
  relative_id: string | null;
  oauth_provider: string;
  oauth_user_id: string;
  upload_options: FileUploadOptions | null;
};

export const uploadOptionsSchema = z.object({
  compression: z
    .object({
      algorithm: z.enum([CompressionAlgorithm.ZLIB]),
      chunkSize: z.number().optional(),
    })
    .optional(),
  encryption: z
    .object({
      algorithm: z.enum([EncryptionAlgorithm.AES_256_GCM]),
      chunkSize: z.number().optional(),
    })
    .optional(),
})

// & operator is used for ensure it represents a FileUploadOptions object
export type UploadOptions = z.infer<typeof uploadOptionsSchema> &
  FileUploadOptions

export const fileUploadSchema = z.object({
  id: z.string(),
  rootId: z.string(),
  relativeId: z.string().nullable(),
  type: z.nativeEnum(UploadType),
  status: z.nativeEnum(UploadStatus),
  fileTree: z.null(),
  name: z.string(),
  mimeType: z.string().nullable(),
  oauthProvider: z.string(),
  oauthUserId: z.string(),
})

export type FileUpload = z.infer<typeof fileUploadSchema> & {
  uploadOptions: FileUploadOptions | null
}

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
    upload_options: upload.uploadOptions,
  }
}

export const folderUploadSchema = z.object({
  id: z.string(),
  rootId: z.string(),
  relativeId: z.string().nullable(),
  type: z.nativeEnum(UploadType),
  status: z.nativeEnum(UploadStatus),
  fileTree: FolderTreeFolderSchema,
  name: z.string(),
  mimeType: z.null(),
  oauthProvider: z.string(),
  oauthUserId: z.string(),
  uploadOptions: z.null(),
})

export type FolderUpload = z.infer<typeof folderUploadSchema>
export type Upload = FileUpload | FolderUpload

export type UploadArtifacts = FileArtifacts | FolderArtifacts

export type FileArtifacts = {
  metadata: OffchainFileMetadata
}

export type FolderArtifacts = {
  metadata: OffchainFolderMetadata
  childrenArtifacts: UploadArtifacts[]
}
