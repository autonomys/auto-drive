import { User } from '../../src/models/users/user.js'
import { UploadsUseCases } from '../../src/useCases/uploads/uploads.js'
import { PreconditionError } from './error.js'

export const uploadFile = async (
  user: User,
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
