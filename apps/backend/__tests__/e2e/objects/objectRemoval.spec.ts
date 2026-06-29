import { UserWithOrganization } from '@auto-drive/models'
import { ObjectUseCases } from '../../../src/core/index.js'
import {
  AsyncDownloadsUseCases,
  DownloadUseCase,
} from '../../../src/core/downloads/index.js'
import { S3UseCases } from '../../../src/core/s3/index.js'
import { s3ObjectMappingsRepository } from '../../../src/infrastructure/repositories/index.js'
import { dbMigration } from '../../utils/dbMigrate.js'
import {
  createMockUser,
  mockRabbitPublish,
  unmockMethods,
} from '../../utils/mocks.js'
import { uploadFile } from '../../utils/uploads.js'
import { jest } from '@jest/globals'
import { ObjectNotFoundError } from '../../../src/errors/index.js'
import { AuthManager } from '../../../src/infrastructure/services/auth/index.js'

const S3_BUCKET = 'removal-bucket'
const S3_KEY = 'dir/removed.txt'

const listS3Keys = async (): Promise<string[]> => {
  const result = await S3UseCases.listObjects({
    bucket: S3_BUCKET,
    prefix: '',
    delimiter: null,
    maxKeys: 1000,
    continuationToken: null,
  })
  return result.objects.map((o) => o.key)
}

/**
 * Verifies the end-to-end behaviour of removing ("Remove" in the UI) a file:
 * once an owner removes an object it must disappear from every view and stop
 * being downloadable for everyone (owner, other users, anonymous, S3/SDK),
 * remaining only in the owner's Trash. Restoring it reverses all of that.
 */
describe('Object removal', () => {
  let owner: UserWithOrganization
  // A user the owner shared the file with. Their (non-admin) share row stays
  // active after the owner removes the file globally, so it guards against the
  // share listing leaking objects the owner has trashed.
  let sharedWith: UserWithOrganization
  let fileCid: string
  // An async download queued while the object was still available — used to
  // prove the worker refuses to serve it once the owner removes it.
  let queuedDownloadId: string

  const uploadedMetadata = (cid: string) =>
    ObjectUseCases.getMetadata(cid).then((e) => e._unsafeUnwrap())

  beforeAll(async () => {
    mockRabbitPublish()
    // Keep authorizeDownload off the file-gateway network during tests.
    jest.spyOn(ObjectUseCases, 'syncingIsObjectBanned').mockResolvedValue(false)
    await dbMigration.up()
    owner = createMockUser()
    sharedWith = createMockUser()
    fileCid = await uploadFile(owner, 'test.txt', 'test', 'text/plain')
    // Expose the same file over the S3 API so we can prove the S3 surface
    // (list + get) honours removal/restore in lockstep with the file, without
    // adding a second object that would perturb the global/owner listings.
    await s3ObjectMappingsRepository.createMapping(
      S3_BUCKET,
      S3_KEY,
      fileCid,
      null,
    )
    // Share the file with another user so the share-listing surface is covered.
    jest.spyOn(AuthManager, 'getUserFromPublicId').mockResolvedValue(sharedWith)
    const shareResult = await ObjectUseCases.shareObject(
      owner,
      fileCid,
      sharedWith.publicId!,
    )
    expect(shareResult.isOk()).toBe(true)
  })

  afterAll(async () => {
    unmockMethods()
    await dbMigration.down()
  })

  describe('while available (before removal)', () => {
    it('is not flagged as deleted', async () => {
      expect(await ObjectUseCases.isObjectDeleted(fileCid)).toBe(false)
    })

    it('is listed under the owner files', async () => {
      const summary = await ObjectUseCases.getRootObjects(
        { scope: 'user', user: owner },
        100,
        0,
      )
      expect(summary.rows).toMatchObject([{ headCid: fileCid }])
    })

    it('is visible in the global explorer', async () => {
      const summary = await ObjectUseCases.getRootObjects({ scope: 'global' })
      expect(summary.rows).toMatchObject([{ headCid: fileCid }])
    })

    it('is discoverable by CID via global search', async () => {
      const search = await ObjectUseCases.searchByCIDOrName(fileCid, 5, {
        scope: 'global',
      })
      expect(search).toMatchObject([{ cid: fileCid }])
    })

    it('can be downloaded by the owner, by another user and anonymously', async () => {
      const anotherUser = createMockUser()
      const byOwner = await DownloadUseCase.downloadObjectByUser(owner, fileCid)
      const byOther = await DownloadUseCase.downloadObjectByUser(
        anotherUser,
        fileCid,
      )
      const byAnonymous =
        await DownloadUseCase.downloadObjectByAnonymous(fileCid)
      expect(byOwner.isOk()).toBe(true)
      expect(byOther.isOk()).toBe(true)
      expect(byAnonymous.isOk()).toBe(true)
    })

    it('passes download authorization', async () => {
      const authResult = await ObjectUseCases.authorizeDownload(fileCid)
      expect(authResult.isOk()).toBe(true)
    })

    it('can have an async download queued', async () => {
      const result = await AsyncDownloadsUseCases.createDownload(owner, fileCid)
      expect(result.isOk()).toBe(true)
      queuedDownloadId = result._unsafeUnwrap().id
    })

    it('is listed and retrievable over the S3 API (rclone/aws-cli)', async () => {
      expect(await listS3Keys()).toContain(S3_KEY)
      const getResult = await S3UseCases.getObject({
        Bucket: S3_BUCKET,
        Key: S3_KEY,
      })
      expect(getResult.isOk()).toBe(true)
    })

    it('is listed under the share recipient files', async () => {
      const shared = await ObjectUseCases.getSharedRoots(sharedWith)
      expect(shared.rows).toMatchObject([{ headCid: fileCid }])
    })
  })

  describe('after the owner removes it', () => {
    beforeAll(async () => {
      const result = await ObjectUseCases.markAsDeleted(owner, fileCid)
      expect(result.isOk()).toBe(true)
    })

    it('is flagged as deleted', async () => {
      expect(await ObjectUseCases.isObjectDeleted(fileCid)).toBe(true)
    })

    it('no longer appears under the owner files', async () => {
      const summary = await ObjectUseCases.getRootObjects(
        { scope: 'user', user: owner },
        100,
        0,
      )
      expect(summary.rows).toMatchObject([])
    })

    it('is visible to the owner in Trash', async () => {
      const deleted = await ObjectUseCases.getMarkedAsDeletedRoots(owner)
      expect(deleted.rows).toMatchObject([{ headCid: fileCid }])
    })

    it('is no longer visible in the global explorer', async () => {
      const summary = await ObjectUseCases.getRootObjects({ scope: 'global' })
      expect(summary.rows).toMatchObject([])
    })

    it('can no longer be found by CID or name via global search', async () => {
      const metadata = await uploadedMetadata(fileCid)
      const byCid = await ObjectUseCases.searchByCIDOrName(fileCid, 5, {
        scope: 'global',
      })
      const byName = await ObjectUseCases.searchMetadataByName(
        metadata.name!,
        5,
        { scope: 'global' },
      )
      expect(byCid).toMatchObject([])
      expect(byName).toMatchObject([])
    })

    it('fails download authorization with object-not-found', async () => {
      const authResult = await ObjectUseCases.authorizeDownload(fileCid)
      expect(authResult.isErr()).toBe(true)
      expect(authResult._unsafeUnwrapErr()).toBeInstanceOf(ObjectNotFoundError)
    })

    it('cannot be downloaded by anyone (owner / other user / anonymous)', async () => {
      const anotherUser = createMockUser()
      const byOwner = await DownloadUseCase.downloadObjectByUser(owner, fileCid)
      const byOther = await DownloadUseCase.downloadObjectByUser(
        anotherUser,
        fileCid,
      )
      const byAnonymous =
        await DownloadUseCase.downloadObjectByAnonymous(fileCid)

      expect(byOwner.isErr()).toBe(true)
      expect(byOwner._unsafeUnwrapErr()).toBeInstanceOf(ObjectNotFoundError)
      expect(byOther.isErr()).toBe(true)
      expect(byOther._unsafeUnwrapErr()).toBeInstanceOf(ObjectNotFoundError)
      expect(byAnonymous.isErr()).toBe(true)
      expect(byAnonymous._unsafeUnwrapErr()).toBeInstanceOf(ObjectNotFoundError)
    })

    it('cannot have a new async download queued', async () => {
      const result = await AsyncDownloadsUseCases.createDownload(owner, fileCid)
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ObjectNotFoundError)
    })

    it('is not served by a download queued before removal', async () => {
      const result =
        await AsyncDownloadsUseCases.asyncDownload(queuedDownloadId)
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ObjectNotFoundError)
    })

    it('is hidden from S3 listing and not retrievable over S3', async () => {
      expect(await listS3Keys()).not.toContain(S3_KEY)
      const getResult = await S3UseCases.getObject({
        Bucket: S3_BUCKET,
        Key: S3_KEY,
      })
      expect(getResult.isErr()).toBe(true)
      expect(getResult._unsafeUnwrapErr()).toBeInstanceOf(ObjectNotFoundError)
    })

    it('no longer appears under the share recipient files', async () => {
      const shared = await ObjectUseCases.getSharedRoots(sharedWith)
      expect(shared.rows).toMatchObject([])
    })
  })

  describe('after the owner restores it', () => {
    beforeAll(async () => {
      const result = await ObjectUseCases.restoreObject(owner, fileCid)
      expect(result.isOk()).toBe(true)
    })

    it('is no longer flagged as deleted', async () => {
      expect(await ObjectUseCases.isObjectDeleted(fileCid)).toBe(false)
    })

    it('is no longer in Trash', async () => {
      const deleted = await ObjectUseCases.getMarkedAsDeletedRoots(owner)
      expect(deleted.rows).toMatchObject([])
    })

    it('is listed under the owner files again', async () => {
      const summary = await ObjectUseCases.getRootObjects(
        { scope: 'user', user: owner },
        100,
        0,
      )
      expect(summary.rows).toMatchObject([{ headCid: fileCid }])
    })

    it('is visible in the global explorer again', async () => {
      const summary = await ObjectUseCases.getRootObjects({ scope: 'global' })
      expect(summary.rows).toMatchObject([{ headCid: fileCid }])
    })

    it('is discoverable by CID via global search again', async () => {
      const search = await ObjectUseCases.searchByCIDOrName(fileCid, 5, {
        scope: 'global',
      })
      expect(search).toMatchObject([{ cid: fileCid }])
    })

    it('can be downloaded by anyone again', async () => {
      const anotherUser = createMockUser()
      const byOwner = await DownloadUseCase.downloadObjectByUser(owner, fileCid)
      const byOther = await DownloadUseCase.downloadObjectByUser(
        anotherUser,
        fileCid,
      )
      const byAnonymous =
        await DownloadUseCase.downloadObjectByAnonymous(fileCid)
      expect(byOwner.isOk()).toBe(true)
      expect(byOther.isOk()).toBe(true)
      expect(byAnonymous.isOk()).toBe(true)
    })

    it('is listed and retrievable over the S3 API again', async () => {
      expect(await listS3Keys()).toContain(S3_KEY)
      const getResult = await S3UseCases.getObject({
        Bucket: S3_BUCKET,
        Key: S3_KEY,
      })
      expect(getResult.isOk()).toBe(true)
    })

    it('is listed under the share recipient files again', async () => {
      const shared = await ObjectUseCases.getSharedRoots(sharedWith)
      expect(shared.rows).toMatchObject([{ headCid: fileCid }])
    })
  })
})
