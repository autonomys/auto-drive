import { FileUploadOptions } from '@autonomys/auto-drive'

type UploadType = 'file' | 'folder'
type UploadStatus = 'pending' | 'migrating' | 'cancelled' | 'failed'

export interface FileUpload {
  id: string
  rootId: string
  relativeId: string | null
  type: UploadType
  status: UploadStatus
  fileTree: null
  name: string
  mimeType: string | null
  oauthProvider: string
  oauthUserId: string
  uploadOptions: FileUploadOptions | null
}

export type FileTree = FileFileTree | FolderFileTree

export type FileFileTree = {
  id: string
  name: string
  type: 'file'
}

export type FolderFileTree = {
  id: string
  type: 'folder'
  name: string
  children: FileTree[]
}

export interface FolderUpload {
  id: string
  rootId: string
  relativeId: string | null
  type: UploadType
  status: UploadStatus
  fileTree: FolderFileTree
  name: string
  mimeType: string | null
  oauthProvider: string
  oauthUserId: string
  uploadOptions: null
}

export const a = {
  id: '1',
  rootId: '1',
  relativeId: null,
  fileTree: null,
  name: 'test',
}
