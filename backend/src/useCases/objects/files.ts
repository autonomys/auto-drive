import {
  fileMetadata,
  folderMetadata,
  MetadataType,
  OffchainFileMetadata,
  OffchainMetadata,
} from '@autonomys/auto-dag-data'
import PizZip from 'pizzip'
import {
  UserWithOrganization,
  InteractionType,
  FileDownload,
  FileArtifacts,
  FolderArtifacts,
  UploadArtifacts,
  UploadType,
} from '@auto-drive/models'
import {
  NodesUseCases,
  ObjectUseCases,
  OwnershipUseCases,
  SubscriptionsUseCases,
} from '../index.js'
import { uploadsRepository } from '../../repositories/uploads/uploads.js'
import { BlockstoreUseCases } from '../uploads/blockstore.js'
import { asyncIterableToPromiseOfArray } from '@autonomys/asynchronous'
import { downloadService } from '../../services/download/index.js'
import { FileGateway } from '../../services/dsn/fileGateway/index.js'
import { config } from '../../config.js'
import { Readable } from 'stream'

const generateFileArtifacts = async (
  uploadId: string,
): Promise<FileArtifacts> => {
  const upload = await uploadsRepository.getUploadEntryById(uploadId)
  if (!upload) {
    throw new Error('Upload not found')
  }
  if (upload.type !== UploadType.FILE) {
    throw new Error('Upload is not a file')
  }

  const cid = await BlockstoreUseCases.getFileUploadIdCID(uploadId)

  let chunks = await BlockstoreUseCases.getChunksByNodeType(
    uploadId,
    MetadataType.FileChunk,
  )
  if (chunks.length === 0) {
    chunks = await BlockstoreUseCases.getChunksByNodeType(
      uploadId,
      MetadataType.File,
    )
  }

  const totalSize = chunks.reduce(
    (acc, e) => acc + e.size.valueOf(),
    BigInt(0).valueOf(),
  )

  const metadata = fileMetadata(
    cid,
    chunks,
    totalSize,
    upload.name,
    upload.mime_type,
    upload.upload_options ?? undefined,
  )

  return {
    metadata,
  }
}

const generateFolderArtifacts = async (
  uploadId: string,
): Promise<FolderArtifacts> => {
  const upload = await uploadsRepository.getUploadEntryById(uploadId)
  if (!upload) {
    throw new Error('Upload not found')
  }
  if (upload.type !== UploadType.FOLDER) {
    throw new Error('Upload is not a folder')
  }
  if (!upload.file_tree) {
    throw new Error('Upload has no file tree')
  }

  const childrenUploads = await Promise.all(
    upload.file_tree.children.map((e) =>
      uploadsRepository
        .getUploadEntriesByRelativeId(upload.root_upload_id, e.id)
        .then((upload) => {
          if (!upload) {
            throw new Error(`Upload with relative ID ${e.id} not found`)
          }
          return upload
        }),
    ),
  )

  const folderCID = await BlockstoreUseCases.getUploadCID(uploadId)

  const childrenArtifacts = await Promise.all(
    childrenUploads.map((e) => generateArtifacts(e.id)),
  )

  const childrenMetadata = childrenArtifacts.map((e) => ({
    cid: e.metadata.dataCid,
    name: e.metadata.name,
    type: e.metadata.type,
    totalSize: e.metadata.totalSize,
  }))

  const metadata = folderMetadata(
    folderCID,
    childrenMetadata,
    upload.name,
    upload.upload_options ?? undefined,
  )

  return {
    metadata,
    childrenArtifacts,
  }
}

const generateArtifacts = async (
  uploadId: string,
): Promise<UploadArtifacts> => {
  const upload = await uploadsRepository.getUploadEntryById(uploadId)
  if (!upload) {
    throw new Error('Upload not found')
  }
  return upload.type === UploadType.FILE
    ? generateFileArtifacts(uploadId)
    : generateFolderArtifacts(uploadId)
}

const retrieveAndReassembleFile = async (
  metadata: OffchainFileMetadata,
): Promise<Readable> => {
  if (metadata.totalChunks === 1) {
    const chunkData = await NodesUseCases.getChunkData(metadata.chunks[0].cid)
    if (!chunkData) {
      throw new Error('Chunk not found')
    }

    return Readable.from(chunkData)
  }

  const SIMULTANEOUS_CHUNKS = 100
  let currentIndex = 0
  return new Readable({
    async read() {
      if (currentIndex >= metadata.chunks.length) {
        this.push(null)
        return
      }

      const endIndex = currentIndex + SIMULTANEOUS_CHUNKS
      const chunks = metadata.chunks.slice(currentIndex, endIndex)
      currentIndex = endIndex

      try {
        const chunkedData = await Promise.all(
          chunks.map((chunk) => NodesUseCases.getChunkData(chunk.cid)),
        )

        if (chunkedData.some((e) => e === undefined)) {
          this.destroy(new Error('Chunk not found'))
          return
        }

        for (const chunk of chunkedData) {
          if (chunk === undefined) {
            this.destroy(new Error('Chunk not found'))
            return
          }
          const canContinue = this.push(Buffer.from(chunk))
          if (!canContinue) {
            await new Promise((resolve) => this.once('drain', resolve))
          }
        }
      } catch (err) {
        this.destroy(err instanceof Error ? err : new Error(String(err)))
      }
    },
  })
}

const retrieveAndReassembleFolderAsZip = async (
  parent: PizZip,
  cid: string,
): Promise<Readable> => {
  const metadata = await ObjectUseCases.getMetadata(cid)
  if (!metadata) {
    throw new Error(`Metadata with CID ${cid} not found`)
  }
  if (!metadata.name) {
    throw new Error(`Metadata with CID ${cid} has no name`)
  }

  if (metadata.type !== 'folder') {
    throw new Error(`Metadata with CID ${cid} is not a folder`)
  }

  const folder = parent.folder(metadata.name)

  await Promise.all([
    ...metadata.children
      .filter((e) => e.type === 'file')
      .map(async (e) => {
        const data = Buffer.concat(
          await asyncIterableToPromiseOfArray(
            await downloadService.download(e.cid),
          ),
        )

        if (!data) {
          throw new Error(`Data with CID ${e.cid} not found`)
        }

        return folder.file(e.name!, data)
      }),
    ...metadata.children
      .filter((e) => e.type === 'folder')
      .map(async (e) => {
        return retrieveAndReassembleFolderAsZip(folder, e.cid)
      }),
  ])

  return Readable.from(folder.generate({ type: 'nodebuffer' }))
}

const downloadObjectByUser = async (
  reader: UserWithOrganization,
  cid: string,
  blockingTags?: string[],
): Promise<FileDownload> => {
  const information = await ObjectUseCases.getObjectInformation(cid)
  if (!information) {
    throw new Error(`Metadata with CID ${cid} not found`)
  }

  const pendingCredits =
    await SubscriptionsUseCases.getPendingCreditsByUserAndType(
      reader,
      InteractionType.Download,
    )
  const { metadata, tags } = information

  if (pendingCredits < metadata.totalSize) {
    throw new Error('Not enough download credits')
  }

  if (blockingTags && tags.some((tag) => blockingTags.includes(tag))) {
    throw new Error('File is blocked')
  }

  return {
    metadata,
    startDownload: async () => {
      await SubscriptionsUseCases.registerInteraction(
        reader,
        InteractionType.Download,
        metadata.totalSize,
      )

      const download = await downloadService.download(cid)

      return download
    },
  }
}

const downloadObjectByAnonymous = async (
  cid: string,
  blockingTags?: string[],
): Promise<FileDownload> => {
  const information = await ObjectUseCases.getObjectInformation(cid)
  if (!information) {
    throw new Error(`Metadata with CID ${cid} not found`)
  }
  const { metadata, tags } = information
  if (metadata.totalSize > config.params.maxAnonymousDownloadSize) {
    throw new Error('File too large to be downloaded anonymously.')
  }
  if (blockingTags && tags.some((tag) => blockingTags.includes(tag))) {
    throw new Error('File is blocked')
  }

  return {
    metadata,
    startDownload: async () => downloadService.download(cid),
  }
}

const handleFileUploadFinalization = async (
  user: UserWithOrganization,
  uploadId: string,
): Promise<string> => {
  const pendingCredits =
    await SubscriptionsUseCases.getPendingCreditsByUserAndType(
      user,
      InteractionType.Upload,
    )
  const { metadata } = await generateFileArtifacts(uploadId)
  const upload = await uploadsRepository.getUploadEntryById(uploadId)
  if (pendingCredits < metadata.totalSize) {
    throw new Error('Not enough upload credits')
  }

  await OwnershipUseCases.setUserAsAdmin(user, metadata.dataCid)

  const isRootUpload = upload?.root_upload_id === uploadId
  if (isRootUpload) {
    await ObjectUseCases.saveMetadata(
      metadata.dataCid,
      metadata.dataCid,
      metadata,
    )
  }

  await SubscriptionsUseCases.registerInteraction(
    user,
    InteractionType.Upload,
    metadata.totalSize.valueOf(),
  )

  return metadata.dataCid
}

const handleFolderUploadFinalization = async (
  user: UserWithOrganization,
  uploadId: string,
): Promise<string> => {
  const { metadata, childrenArtifacts } =
    await generateFolderArtifacts(uploadId)

  const fullMetadata = [metadata, ...childrenArtifacts.map((e) => e.metadata)]
  await Promise.all(
    fullMetadata.map((childMetadata) =>
      ObjectUseCases.saveMetadata(
        metadata.dataCid,
        childMetadata.dataCid,
        childMetadata,
      ),
    ),
  )

  await OwnershipUseCases.setUserAsAdmin(user, metadata.dataCid)

  return metadata.dataCid
}

const retrieveObject = async (
  metadata: OffchainMetadata,
): Promise<Readable> => {
  const isArchived = await ObjectUseCases.isArchived(metadata.dataCid)

  if (isArchived) {
    return FileGateway.downloadFile(metadata.dataCid)
  }

  return metadata.type === 'folder'
    ? await retrieveAndReassembleFolderAsZip(new PizZip(), metadata.dataCid)
    : retrieveAndReassembleFile(metadata)
}

export const FilesUseCases = {
  handleFileUploadFinalization,
  handleFolderUploadFinalization,
  downloadObjectByUser,
  downloadObjectByAnonymous,
  retrieveObject,
}
