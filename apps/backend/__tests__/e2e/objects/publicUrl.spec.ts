import { InteractionType, UserWithOrganization } from '@auto-drive/models'
import {
  PublishedObject,
  publishedObjectsRepository,
} from '../../../src/infrastructure/repositories/objects/publishedObjects.js'
import { getDatabase } from '../../../src/infrastructure/drivers/pg.js'
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
import { v4 } from 'uuid'

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

  it('should return the oldest public link when the user already has several', async () => {
    const duplicatesUser = createMockUser()
    await uploadFile(duplicatesUser, 'test.txt', content, 'text/plain')

    // Links created twice before the fix. The newer row is inserted first, so
    // a lookup without ORDER BY finds it before the oldest one.
    const newer = await publishedObjectsRepository.createPublishedObject(
      v4(),
      duplicatesUser.publicId!,
      fileCid,
    )
    const oldest = await publishedObjectsRepository.createPublishedObject(
      v4(),
      duplicatesUser.publicId!,
      fileCid,
    )
    const db = await getDatabase()
    await db.query(
      'UPDATE public.published_objects SET created_at = $1 WHERE id = $2',
      [new Date(Date.now() - 24 * 60 * 60 * 1000), oldest.id],
    )

    const publishedAgain = await ObjectUseCases.publishObject(
      duplicatesUser,
      fileCid,
    )

    expect(publishedAgain.id).toBe(oldest.id)
    expect(publishedAgain.id).not.toBe(newer.id)
  })

  it('should only remove the public link of the caller when unpublishing', async () => {
    const userA = createMockUser()
    const userB = createMockUser()
    await uploadFile(userA, 'test.txt', content, 'text/plain')
    await uploadFile(userB, 'test.txt', content, 'text/plain')
    const linkA = await ObjectUseCases.publishObject(userA, fileCid)
    const linkB = await ObjectUseCases.publishObject(userB, fileCid)

    const result = await ObjectUseCases.unpublishObject(userB, fileCid)

    expect(result.isOk()).toBe(true)
    await expect(
      publishedObjectsRepository.getPublishedObjectById(linkB.id),
    ).resolves.toBeNull()
    await expect(
      publishedObjectsRepository.getPublishedObjectById(linkA.id),
    ).resolves.toMatchObject({ id: linkA.id, publicId: userA.publicId })
  })

  it('should do nothing when the caller has no public link for the cid', async () => {
    const userWithoutLink = createMockUser()

    const result = await ObjectUseCases.unpublishObject(
      userWithoutLink,
      fileCid,
    )

    expect(result.isOk()).toBe(true)
    await expect(
      publishedObjectsRepository.getPublishedObjectById(publishedObject.id),
    ).resolves.toMatchObject({ id: publishedObject.id })
  })
})
