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
  FolderTreeFolder,
  UserWithOrganization,
} from '@auto-drive/models'
import { filePartsRepository } from '../../repositories/uploads/fileParts.js'
import { FileProcessingUseCase as UploadingProcessingUseCase } from './uploadProcessing.js'
import { fileProcessingInfoRepository } from '../../repositories/uploads/fileProcessingInfo.js'
import { FilesUseCases } from '../objects/files.js'
import { NodesUseCases, ObjectUseCases } from '../objects/index.js'
import { cidToString, FileUploadOptions } from '@autonomys/auto-dag-data'
import { TaskManager } from '../../services/taskManager/index.js'
import { Task } from '../../services/taskManager/tasks.js'
import { chunkArray } from '../../utils/misc.js'
import { config } from '../../config.js'
import { blockstoreRepository } from '../../repositories/uploads/blockstore.js'
import { BlockstoreUseCases } from './blockstore.js'

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

const checkPermissions = async (
  upload: UploadEntry,
  user: UserWithOrganization,
) => {
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
  user: UserWithOrganization,
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
  user: UserWithOrganization,
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
  user: UserWithOrganization,
  uploadId: string,
  relativeId: string,
  name: string,
  mimeType: string | null,
  uploadOptions: FileUploadOptions | null = null,
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
  user: UserWithOrganization,
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
  user: UserWithOrganization,
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

  const isRootUpload = upload.root_upload_id === uploadId
  if (isRootUpload) {
    await scheduleNodeMigration(uploadId)
  }

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
    UploadStatus.MIGRATING,
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

const scheduleNodeMigration = async (uploadId: string): Promise<void> => {
  const tasks: Task[] = [
    {
      id: 'migrate-upload-nodes',
      params: {
        uploadId,
      },
    },
  ]
  TaskManager.publish(tasks)
}

const removeUploadArtifacts = async (uploadId: string): Promise<void> => {
  await blockstoreRepository.deleteBlockstoreEntries(uploadId)
  await uploadsRepository.deleteEntriesByRootUploadId(uploadId)
  await filePartsRepository.deleteChunksByUploadId(uploadId)
  await fileProcessingInfoRepository.deleteFileProcessingInfo(uploadId)
}

const scheduleNodesPublish = async (cid: string): Promise<void> => {
  const nodes = await NodesUseCases.getCidsByRootCid(cid)

  const tasks: Task[] = chunkArray(
    nodes,
    config.params.maxUploadNodesPerBatch,
  ).map((nodes) => ({
    id: 'publish-nodes',
    params: {
      nodes,
    },
  }))

  TaskManager.publish(tasks)
}

const scheduleUploadTagging = async (cid: string): Promise<void> => {
  const tasks: Task[] = [
    {
      id: 'tag-upload',
      params: {
        cid,
      },
    },
  ]

  TaskManager.publish(tasks)
}

const tagUpload = async (cid: string): Promise<void> => {
  const metadata = await ObjectUseCases.getMetadata(cid)
  if (metadata?.type === 'folder') {
    await Promise.all(metadata.children.map((child) => tagUpload(child.cid)))
  } else {
    const fileExtension = metadata?.name?.split('.').pop()
    const isFileInsecure =
      fileExtension &&
      config.params.forbiddenExtensions.some((ext) => ext.match(fileExtension))
    if (isFileInsecure) {
      await ObjectUseCases.addTag(cid, 'insecure')
    }
  }

  await scheduleNodesPublish(cid)
}

const processMigration = async (uploadId: string): Promise<void> => {
  const upload = await uploadsRepository.getUploadEntryById(uploadId)
  if (!upload) {
    throw new Error('Upload not found')
  }

  const cid = await BlockstoreUseCases.getUploadCID(uploadId)
  await NodesUseCases.migrateFromBlockstoreToNodesTable(uploadId)

  await removeUploadArtifacts(uploadId)
  await scheduleUploadTagging(cidToString(cid))
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
  scheduleNodesPublish,
  scheduleUploadTagging,
  tagUpload,
}
