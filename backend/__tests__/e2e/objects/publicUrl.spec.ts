import { InteractionType } from '../../../src/models/objects/interactions'
import { UserWithOrganization } from '../../../src/models/users/user'
import { PublishedObject } from '../../../src/repositories/objects/publishedObjects'
import { AuthManager } from '../../../src/services/auth'
import { ObjectUseCases, SubscriptionsUseCases } from '../../../src/useCases'
import { asyncIterableToPromiseOfArray } from '../../../src/utils/async'
import { dbMigration } from '../../utils/dbMigrate'
import { createMockUser } from '../../utils/mocks'
import { uploadFile } from '../../utils/uploads'
import { jest } from '@jest/globals'

describe('Public URL', () => {
  let user: UserWithOrganization
  let fileCid: string
  let publishedObject: PublishedObject
  const content = 'test'

  beforeAll(async () => {
    await dbMigration.up()
    user = createMockUser()
    fileCid = await uploadFile(user, 'test.txt', content, 'text/plain')
  })

  afterAll(async () => {
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

    const { metadata, startDownload } =
      await ObjectUseCases.downloadPublishedObject(publishedObject.id)

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
