import { OffchainMetadata } from '@autonomys/auto-dag-data'

export interface ObjectInformation {
  cid: string
  metadata: OffchainMetadata
  uploadStatus: UploadStatus
  owners: Owner[]
}

export interface UploadStatus {
  uploadedNodes: number | null
  totalNodes: number | null
  archivedNodes: number | null
  minimumBlockDepth: number | null
  maximumBlockDepth: number | null
}

export interface Owner {
  publicId: string
  role: OwnerRole
}

export enum OwnerRole {
  ADMIN = 'admin',
  VIEWER = 'viewer',
}

export type ObjectSearchResult = {
  cid: string
  name: string
}

export type ObjectSummary = {
  headCid: string
  name?: string
  size: string
  owners: Owner[]
  uploadStatus: UploadStatus
} & (
  | {
      type: 'file'
      mimeType?: string
    }
  | {
      type: 'folder'
      children: (OffchainMetadata & {
        type: 'folder'
      })['children']
    }
)

export const getObjectSummary = (object: ObjectInformation): ObjectSummary => {
  return object.metadata.type === 'folder'
    ? {
        headCid: object.metadata.dataCid,
        name: object.metadata.name,
        type: object.metadata.type,
        size: object.metadata.totalSize.toString(),
        owners: object.owners,
        children: object.metadata.children,
        uploadStatus: object.uploadStatus,
      }
    : {
        headCid: object.metadata.dataCid,
        name: object.metadata.name,
        type: object.metadata.type,
        size: object.metadata.totalSize.toString(),
        mimeType: object.metadata.mimeType,
        uploadStatus: object.uploadStatus,
        owners: object.owners,
      }
}
