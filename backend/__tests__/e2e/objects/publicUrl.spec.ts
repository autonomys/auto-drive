import { InteractionType, UserWithOrganization } from '@auto-drive/models'
import { PublishedObject } from '../../../src/infrastructure/repositories/objects/publishedObjects.js'
import { AuthManager } from '../../../src/infrastructure/services/auth/index.js'
import {
  ObjectUseCases,
  SubscriptionsUseCases,
} from '../../../src/core/index.js'
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

  it('should be downloadable by public id and credits should be deducted', async () => {
    jest.spyOn(AuthManager, 'getUserFromPublicId').mockResolvedValue(user)
    jest.spyOn(ObjectUseCases, 'shouldBlockDownload').mockResolvedValue(ok())

    const downloadResult = await ObjectUseCases.downloadPublishedObject(
      publishedObject.id,
    )
    if (downloadResult.isErr()) {
      throw downloadResult.error
    }
    const { metadata, startDownload } = downloadResult.value

    expect(metadata).toMatchObject({
      type: 'file',
      dataCid: publishedObject.cid,
    })

    const pendingCredits =
      await SubscriptionsUseCases.getPendingCreditsByUserAndType(
        user,
        InteractionType.Download,
      )

    const downloadedContent = Buffer.concat(
      await asyncIterableToPromiseOfArray(await startDownload()),
    )
    expect(downloadedContent).toEqual(Buffer.from(content))

    const updatedPendingCredits =
      await SubscriptionsUseCases.getPendingCreditsByUserAndType(
        user,
        InteractionType.Download,
      )

    expect(updatedPendingCredits).toBe(
      pendingCredits - downloadedContent.length,
    )
  })
})
