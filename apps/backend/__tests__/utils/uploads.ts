import { FolderTreeFolder, UserWithOrganization } from '@auto-drive/models'
import { UploadsUseCases } from '../../src/core/uploads/uploads.js'
import { PreconditionError } from './error.js'

export const uploadFile = async (
  user: UserWithOrganization,
  name: string,
  content: Buffer | string,
  mimeType: string,
) => {
  const upload = await UploadsUseCases.createFileUpload(
    user,
    name,
    mimeType,
    null,
  )

  if (!upload) {
    throw new PreconditionError('Failed to create upload')
  }

  content = typeof content === 'string' ? Buffer.from(content) : content

  await UploadsUseCases.uploadChunk(user, upload.id, 0, content).catch(() => {
    throw new PreconditionError('Failed to upload chunk')
  })

  const cid = await UploadsUseCases.completeUpload(user, upload.id).catch(
    () => {
      throw new PreconditionError('Failed to complete upload')
    },
  )

  return cid
}

/**
 * Uploads a flat folder (a single directory containing the given files) and
 * returns the folder root CID alongside each child file CID. Mirrors the real
 * finalization flow so every child file ends up with its own admin ownership
 * row while removal only targets the folder root.
 */
export const uploadFolder = async (
  user: UserWithOrganization,
  folderName: string,
  files: { name: string; content: Buffer | string; mimeType: string }[],
): Promise<{ folderCid: string; childCids: Record<string, string> }> => {
  const fileTree: FolderTreeFolder = {
    name: folderName,
    type: 'folder',
    id: folderName,
    children: files.map((file) => ({
      type: 'file',
      name: file.name,
      id: file.name,
    })),
  }

  const folderUpload = await UploadsUseCases.createFolderUpload(
    user,
    folderName,
    fileTree,
    null,
  )
  if (!folderUpload) {
    throw new PreconditionError('Failed to create folder upload')
  }

  const childCids: Record<string, string> = {}
  for (const file of files) {
    const fileUpload = await UploadsUseCases.createFileInFolder(
      user,
      folderUpload.id,
      file.name,
      file.name,
      file.mimeType,
    )

    const content =
      typeof file.content === 'string'
        ? Buffer.from(file.content)
        : file.content

    await UploadsUseCases.uploadChunk(user, fileUpload.id, 0, content).catch(
      () => {
        throw new PreconditionError('Failed to upload folder file chunk')
      },
    )

    childCids[file.name] = await UploadsUseCases.completeUpload(
      user,
      fileUpload.id,
    ).catch(() => {
      throw new PreconditionError('Failed to complete folder file upload')
    })
  }

  const folderCid = await UploadsUseCases.completeUpload(
    user,
    folderUpload.id,
  ).catch(() => {
    throw new PreconditionError('Failed to complete folder upload')
  })

  return { folderCid, childCids }
}
