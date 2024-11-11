import { v4 } from 'uuid'
import {
  UploadEntry,
  uploadsRepository,
} from '../../repositories/uploads/uploads.js'
import {
  FileUpload,
  FolderUpload,
  Upload,
  UploadStatus,
  UploadType,
} from '../../models/uploads/upload.js'
import { FolderTreeFolder } from '../../models/objects/folderTree.js'
import { User } from '../../models/users/user.js'
import { filePartsRepository } from '../../repositories/uploads/fileParts.js'
import { FileProcessingUseCase as UploadingProcessingUseCase } from './uploadProcessing.js'
import { fileProcessingInfoRepository } from '../../repositories/uploads/fileProcessingInfo.js'
import { FilesUseCases } from '../objects/files.js'
import { NodesUseCases } from '../objects/index.js'
import { cidToString, FileUploadOptions } from '@autonomys/auto-dag-data'

export const mapTableToModel = (upload: UploadEntry): Upload => {
  return {
    id: upload.id,
    rootId: upload.root_upload_id,
    relativeId: upload.relative_id,
    type: upload.type,
    status: upload.status,
    fileTree: upload.file_tree,
    name: upload.name,
    mimeType: upload.mime_type,
    oauthProvider: upload.oauth_provider,
    oauthUserId: upload.oauth_user_id,
    uploadOptions: upload.upload_options,
  } as Upload
}

const checkPermissions = async (upload: UploadEntry, user: User) => {
  if (
    upload.oauth_provider !== user.oauthProvider ||
    upload.oauth_user_id !== user.oauthUserId
  ) {
    throw new Error('User does not have permission to upload')
  }
}

const initFileProcessing = async (upload: UploadEntry): Promise<void> => {
  await fileProcessingInfoRepository.addFileProcessingInfo({
    upload_id: upload.id,
    last_processed_part_index: null,
    pending_bytes: null,
    created_at: new Date(),
    updated_at: new Date(),
  })
}

const createFileUpload = async (
  user: User,
  name: string,
  mimeType: string | null,
  uploadOptions: FileUploadOptions | null,
  rootId?: string | null,
  relativeId?: string | null,
): Promise<FileUpload> => {
  rootId = rootId ?? null
  relativeId = relativeId ?? null

  const id = v4()
  const upload = await uploadsRepository.createUploadEntry(
    id,
    UploadType.FILE,
    UploadStatus.PENDING,
    name,
    null,
    mimeType,
    rootId ?? id,
    relativeId,
    user.oauthProvider,
    user.oauthUserId,
    uploadOptions,
  )

  await initFileProcessing(upload)

  return mapTableToModel(upload) as FileUpload
}

export const createFolderUpload = async (
  user: User,
  name: string,
  folderTree: FolderTreeFolder,
  uploadOptions: FileUploadOptions | null,
): Promise<FolderUpload> => {
  const uploadId = v4()
  const result = await uploadsRepository.createUploadEntry(
    uploadId,
    UploadType.FOLDER,
    UploadStatus.PENDING,
    name,
    folderTree,
    null,
    uploadId,
    null,
    user.oauthProvider,
    user.oauthUserId,
    uploadOptions,
  )

  return mapTableToModel(result) as FolderUpload
}

const createFileInFolder = async (
  user: User,
  uploadId: string,
  relativeId: string,
  name: string,
  mimeType: string | null,
  uploadOptions: FileUploadOptions | null,
): Promise<FileUpload> => {
  const upload = await uploadsRepository.getUploadEntryById(uploadId)
  if (!upload) {
    throw new Error('Upload not found')
  }

  if (upload.type !== UploadType.FOLDER) {
    throw new Error('Upload is not a folder')
  }

  const file = await createFileUpload(
    user,
    name,
    mimeType,
    uploadOptions,
    uploadId,
    relativeId,
  )

  return file
}

const uploadChunk = async (
  user: User,
  uploadId: string,
  index: number,
  chunkData: Buffer,
): Promise<void> => {
  const upload = await uploadsRepository.getUploadEntryById(uploadId)
  if (!upload) {
    throw new Error('Upload not found')
  }
  await checkPermissions(upload, user)

  await UploadingProcessingUseCase.processChunk(uploadId, chunkData, index)

  await filePartsRepository.addChunk({
    upload_id: uploadId,
    part_index: index,
    data: chunkData,
    created_at: new Date(),
    updated_at: new Date(),
  })
}

const completeUpload = async (
  user: User,
  uploadId: string,
): Promise<string> => {
  const upload = await uploadsRepository.getUploadEntryById(uploadId)
  if (!upload) {
    throw new Error('Upload not found')
  }
  await checkPermissions(upload, user)

  const cid = await UploadingProcessingUseCase.completeUploadProcessing(upload)

  if (upload.type === UploadType.FILE) {
    await FilesUseCases.handleFileUploadFinalization(user, uploadId)
  } else if (upload.type === UploadType.FOLDER) {
    await FilesUseCases.handleFolderUploadFinalization(user, uploadId)
  }

  const updatedUpload = {
    ...upload,
    status: UploadStatus.MIGRATING,
  }

  await uploadsRepository.updateUploadEntry(updatedUpload)

  return cidToString(cid)
}

const getFileFromFolderUpload = async (
  uploadId: string,
): Promise<UploadEntry[]> => {
  const upload = await uploadsRepository.getUploadEntryById(uploadId)
  if (!upload) {
    throw new Error('Upload not found')
  }
  if (upload.type !== UploadType.FOLDER) {
    throw new Error('Upload is not a folder')
  }

  const folderWithFiles = await uploadsRepository.getUploadsByRoot(uploadId)

  return folderWithFiles.filter((e) => e.type === UploadType.FILE)
}

const createSubFolderUpload = async (
  rootId: string,
  fileTree: FolderTreeFolder,
): Promise<FolderUpload> => {
  const parentUpload = await uploadsRepository.getUploadEntryById(rootId)
  if (!parentUpload) {
    throw new Error('Parent upload not found')
  }

  const upload = await uploadsRepository.createUploadEntry(
    v4(),
    UploadType.FOLDER,
    UploadStatus.PENDING,
    fileTree.name,
    fileTree,
    null,
    rootId,
    fileTree.id,
    parentUpload.oauth_provider,
    parentUpload.oauth_user_id,
    null,
  )

  return mapTableToModel(upload) as FolderUpload
}

const getPendingMigrations = async (limit: number): Promise<UploadEntry[]> => {
  const pendingMigrations = await uploadsRepository.getUploadsByStatus(
    UploadStatus.MIGRATING,
    limit,
  )

  return pendingMigrations
}

const processMigration = async (uploadId: string): Promise<void> => {
  const upload = await uploadsRepository.getUploadEntryById(uploadId)
  if (!upload) {
    throw new Error('Upload not found')
  }

  await NodesUseCases.migrateFromBlockstoreToNodesTable(uploadId)

  await uploadsRepository.updateUploadStatusByRootUploadId(
    uploadId,
    UploadStatus.COMPLETED,
  )
}

export const UploadsUseCases = {
  createFileUpload,
  createFolderUpload,
  createFileInFolder,
  uploadChunk,
  completeUpload,
  getFileFromFolderUpload,
  getPendingMigrations,
  processMigration,
  createSubFolderUpload,
}
