import { InteractionType, UserWithOrganization } from '@auto-drive/models'
import { PublishedObject } from '../../../src/infrastructure/repositories/objects/publishedObjects.js'
import { AuthManager } from '../../../src/infrastructure/services/auth/index.js'
import { ObjectUseCases, AccountsUseCases } from '../../../src/core/index.js'
import { asyncIterableToPromiseOfArray } from '@autonomys/asynchronous'
import { dbMigration } from '../../utils/dbMigrate.js'
import {
  createMockUser,
  mockRabbitPublish,
  unmockMethods,
} from '../../utils/mocks.js'
import { uploadFile } from '../../utils/uploads.js'
import { jest } from '@jest/globals'
import { ok } from 'neverthrow'

describe('Public URL', () => {
  let user: UserWithOrganization
  let fileCid: string
  let publishedObject: PublishedObject
  const content = 'test'

  beforeAll(async () => {
    await dbMigration.up()
    mockRabbitPublish()
    user = createMockUser()
    fileCid = await uploadFile(user, 'test.txt', content, 'text/plain')
  })

  afterAll(async () => {
    unmockMethods()
    await dbMigration.down()
  })

  it('should be able to publish and retrieve', async () => {
    publishedObject = await ObjectUseCases.publishObject(user, fileCid)

    expect(publishedObject).toMatchObject({
      publicId: user.publicId,
      cid: fileCid,
      id: expect.any(String),
    })
  })

  it('should return the same public link when publishing again', async () => {
    const publishedAgain = await ObjectUseCases.publishObject(user, fileCid)

    expect(publishedAgain).toMatchObject({
      id: publishedObject.id,
      publicId: user.publicId,
      cid: fileCid,
    })
  })

  it('should give another user publishing the same cid their own public link', async () => {
    const otherUser = createMockUser()
    await uploadFile(otherUser, 'test.txt', content, 'text/plain')

    const otherPublishedObject = await ObjectUseCases.publishObject(
      otherUser,
      fileCid,
    )

    expect(otherPublishedObject).toMatchObject({
      publicId: otherUser.publicId,
      cid: fileCid,
    })
    expect(otherPublishedObject.id).not.toBe(publishedObject.id)
  })

  it('should be downloadable by public id and credits should be deducted', async () => {
    jest.spyOn(AuthManager, 'getUserFromPublicId').mockResolvedValue(user)
    jest.spyOn(ObjectUseCases, 'authorizeDownload').mockResolvedValue(ok())

    const downloadResult = await ObjectUseCases.downloadPublishedObject(
      publishedObject.id,
    )
    if (downloadResult.isErr()) {
      throw downloadResult.error
    }
    const { metadata, startDownload } = downloadResult.value

    expect(metadata).toMatchObject({
      type: 'file',
      size: BigInt(content.length).toString(),
    })

    const pendingCredits =
      await AccountsUseCases.getPendingCreditsByUserAndType(
        user,
        InteractionType.Download,
      )

    const downloadedContent = Buffer.concat(
      await asyncIterableToPromiseOfArray(await startDownload()),
    )
    expect(downloadedContent).toEqual(Buffer.from(content))

    const updatedPendingCredits =
      await AccountsUseCases.getPendingCreditsByUserAndType(
        user,
        InteractionType.Download,
      )

    expect(updatedPendingCredits).toBe(
      pendingCredits - downloadedContent.length,
    )
  })
})
