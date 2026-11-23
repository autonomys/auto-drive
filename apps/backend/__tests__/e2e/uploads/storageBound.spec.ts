import { jest } from '@jest/globals'
import {
  FolderTreeFolder,
  SERVICE_USER_PROVIDER,
  UploadStatus,
  UploadType,
  UserRole,
  UserWithOrganization,
} from '@auto-drive/models'
import { v4 } from 'uuid'
import { config } from '../../../src/config.js'
import { S3UseCases } from '../../../src/core/s3/index.js'
import { UploadsUseCases } from '../../../src/core/uploads/uploads.js'
import { AccountsUseCases } from '../../../src/core/users/accounts.js'
import {
  ForbiddenError,
  PaymentRequiredError,
} from '../../../src/errors/index.js'
import { getDatabase } from '../../../src/infrastructure/drivers/pg.js'
import { uploadsRepository } from '../../../src/infrastructure/repositories/uploads/uploads.js'
import { dbMigration } from '../../utils/dbMigrate.js'
import {
  createMockUser,
  mockRabbitPublish,
  unmockMethods,
} from '../../utils/mocks.js'

describe('Unfinished uploads are bounded by the upload credits of the caller', () => {
  const CREDITS = 100

  beforeAll(async () => {
    await dbMigration.up()
  })

  afterAll(async () => {
    await dbMigration.down()
  })

  beforeEach(() => {
    mockRabbitPublish()
  })

  afterEach(() => {
    unmockMethods()
  })

  const callerWithCredits = async (credits = CREDITS) => {
    const user = createMockUser()
    await AccountsUseCases.initAccount(user.organizationId!, credits, 0)
    return user
  }

  const startUpload = (user: UserWithOrganization) =>
    UploadsUseCases.createFileUpload(user, 'file.bin', null, null)

  const sendPart = (
    user: UserWithOrganization,
    uploadId: string,
    index: number,
    bytes: number,
  ) =>
    UploadsUseCases.uploadChunk(user, uploadId, index, Buffer.alloc(bytes, 1))

  const unfinishedBytes = (user: UserWithOrganization) =>
    uploadsRepository.getUnfinishedBytes(
      user.oauthProvider,
      user.oauthUserId,
      config.uploads.unfinishedWindowMs,
    )

  const count = async (query: string, values: unknown[]) => {
    const db = await getDatabase()
    const result = await db.query<{ count: string }>(query, values)
    return Number(result.rows[0].count)
  }

  const uploadsOf = (user: UserWithOrganization) =>
    count(
      'SELECT count(*) FROM uploads.uploads WHERE oauth_provider = $1 AND oauth_user_id = $2',
      [user.oauthProvider, user.oauthUserId],
    )

  const partsOf = (uploadId: string) =>
    count('SELECT count(*) FROM uploads.file_parts WHERE upload_id = $1', [
      uploadId,
    ])

  const folderTree = (files: number): FolderTreeFolder => ({
    name: 'folder',
    type: 'folder',
    id: 'folder',
    children: Array.from({ length: files }, (_, i) => ({
      name: `file-${i}`,
      type: 'file' as const,
      id: `folder/file-${i}`,
    })),
  })

  describe('a caller with no organisation', () => {
    // What auth answers for an account that has not onboarded. The backend
    // types that answer as UserWithOrganization.
    const notOnboarded = {
      ...createMockUser(),
      onboarded: false,
      organizationId: null,
    } as unknown as UserWithOrganization

    it('cannot create a file upload', async () => {
      await expect(startUpload(notOnboarded)).rejects.toBeInstanceOf(
        ForbiddenError,
      )
      expect(await uploadsOf(notOnboarded)).toBe(0)
    })

    it('cannot create a folder upload', async () => {
      await expect(
        UploadsUseCases.createFolderUpload(
          notOnboarded,
          'folder',
          folderTree(1),
          null,
        ),
      ).rejects.toBeInstanceOf(ForbiddenError)
      expect(await uploadsOf(notOnboarded)).toBe(0)
    })

    it('cannot add a part to an upload', async () => {
      const id = v4()
      await uploadsRepository.createUploadEntry(
        id,
        UploadType.FILE,
        UploadStatus.PENDING,
        'file.bin',
        null,
        null,
        id,
        null,
        notOnboarded.oauthProvider,
        notOnboarded.oauthUserId,
        null,
      )

      await expect(sendPart(notOnboarded, id, 0, 1)).rejects.toBeInstanceOf(
        ForbiddenError,
      )
      expect(await partsOf(id)).toBe(0)
    })
  })

  describe('parts', () => {
    it('are stored up to twice the remaining credits and refused beyond', async () => {
      const user = await callerWithCredits()
      const upload = await startUpload(user)

      await sendPart(user, upload.id, 0, 2 * CREDITS)

      const refused = sendPart(user, upload.id, 1, 1)
      await expect(refused).rejects.toBeInstanceOf(PaymentRequiredError)
      await expect(refused).rejects.toThrow('Not enough upload credits')
      expect(await partsOf(upload.id)).toBe(1)
      expect(await unfinishedBytes(user)).toBe(2 * CREDITS)
    })

    it('count across every pending upload of the caller', async () => {
      const user = await callerWithCredits()
      const first = await startUpload(user)
      const second = await startUpload(user)

      await sendPart(user, first.id, 0, 120)
      await sendPart(user, second.id, 0, 80)

      await expect(sendPart(user, second.id, 1, 1)).rejects.toBeInstanceOf(
        PaymentRequiredError,
      )
    })

    it('of another caller do not count', async () => {
      const user = await callerWithCredits()
      const other = await callerWithCredits()
      await sendPart(other, (await startUpload(other)).id, 0, 2 * CREDITS)

      await sendPart(user, (await startUpload(user)).id, 0, 2 * CREDITS)
    })

    it('of an upload that is no longer pending do not count', async () => {
      const user = await callerWithCredits()
      const finished = await startUpload(user)
      await sendPart(user, finished.id, 0, 2 * CREDITS)
      await uploadsRepository.updateUploadStatusByRootUploadId(
        finished.id,
        UploadStatus.MIGRATING,
      )

      expect(await unfinishedBytes(user)).toBe(0)
      await sendPart(user, (await startUpload(user)).id, 0, 2 * CREDITS)
    })

    it('stored before the window do not count', async () => {
      const user = await callerWithCredits()
      const abandoned = await startUpload(user)
      await sendPart(user, abandoned.id, 0, 2 * CREDITS)
      const db = await getDatabase()
      await db.query(
        `UPDATE uploads.file_parts
         SET updated_at = NOW() - (($2::bigint + 60000) * INTERVAL '1 millisecond')
         WHERE upload_id = $1`,
        [abandoned.id, config.uploads.unfinishedWindowMs],
      )

      expect(await unfinishedBytes(user)).toBe(0)
      await sendPart(user, (await startUpload(user)).id, 0, 2 * CREDITS)
    })
  })

  // Parts admitted and not yet stored count toward the bound as well.
  describe('parts sent at the same time', () => {
    const outcome = async (sends: Promise<void>[]) => {
      const results = await Promise.allSettled(sends)
      const refusals = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      )
      for (const refusal of refusals) {
        expect(refusal.reason).toBeInstanceOf(PaymentRequiredError)
      }
      return {
        stored: results.length - refusals.length,
        refused: refusals.length,
      }
    }

    it('to different uploads are held to the bound together', async () => {
      const user = await callerWithCredits()
      const uploads = await Promise.all(
        Array.from({ length: 10 }, () => startUpload(user)),
      )

      expect(
        await outcome(
          uploads.map((upload) => sendPart(user, upload.id, 0, CREDITS)),
        ),
      ).toEqual({ stored: 2, refused: 8 })
      expect(await unfinishedBytes(user)).toBe(2 * CREDITS)
    })

    it('to one upload are held to the bound together', async () => {
      const user = await callerWithCredits()
      const upload = await startUpload(user)

      expect(
        await outcome(
          Array.from({ length: 10 }, (_, index) =>
            sendPart(user, upload.id, index, CREDITS),
          ),
        ),
      ).toEqual({ stored: 2, refused: 8 })
      expect(await unfinishedBytes(user)).toBe(2 * CREDITS)
    })

    it('are all stored when together they fit', async () => {
      const user = await callerWithCredits()
      const uploads = await Promise.all(
        Array.from({ length: 4 }, () => startUpload(user)),
      )

      expect(
        await outcome(
          uploads.map((upload) => sendPart(user, upload.id, 0, CREDITS / 2)),
        ),
      ).toEqual({ stored: 4, refused: 0 })
    })

    it('in a sustained stream fill the bound and never pass it', async () => {
      const credits = 1024 * 1024
      for (let trial = 0; trial < 2; trial++) {
        const user = await callerWithCredits(credits)
        const uploads = await Promise.all(
          Array.from({ length: 40 }, () => startUpload(user)),
        )

        // Each upload keeps sending parts until 25 in a row are refused.
        await Promise.all(
          uploads.map(async (upload) => {
            let index = 0
            let refusals = 0
            while (refusals < 25) {
              try {
                await sendPart(user, upload.id, index, 16 * 1024)
                index++
                refusals = 0
              } catch (error) {
                expect(error).toBeInstanceOf(PaymentRequiredError)
                refusals++
              }
            }
          }),
        )

        expect(await unfinishedBytes(user)).toBe(2 * credits)
      }
    })

    it('leave room again once a refused part has gone', async () => {
      const user = await callerWithCredits()
      const upload = await startUpload(user)
      await expect(
        sendPart(user, upload.id, 0, 2 * CREDITS + 1),
      ).rejects.toBeInstanceOf(PaymentRequiredError)

      await sendPart(user, upload.id, 0, 2 * CREDITS)
    })
  })

  // Reading credits walks the account's whole interaction history.
  describe('the credits of the account', () => {
    it('are read once for parts that follow each other closely', async () => {
      const user = await callerWithCredits()
      const upload = await startUpload(user)
      const readCredits = jest.spyOn(
        AccountsUseCases,
        'getPendingCreditsByUserAndType',
      )

      for (let index = 0; index < 5; index++) {
        await sendPart(user, upload.id, index, 10)
      }

      expect(readCredits).toHaveBeenCalledTimes(1)
    })

    it('are read again before a part is refused', async () => {
      const user = await callerWithCredits()
      const upload = await startUpload(user)
      const readCredits = jest
        .spyOn(AccountsUseCases, 'getPendingCreditsByUserAndType')
        .mockResolvedValueOnce(CREDITS)
        .mockResolvedValueOnce(10 * CREDITS)
      await sendPart(user, upload.id, 0, 2 * CREDITS)

      // More credits were bought after the first reading.
      await sendPart(user, upload.id, 1, 2 * CREDITS)

      expect(readCredits).toHaveBeenCalledTimes(2)
    })
  })

  describe('folder trees', () => {
    it('are refused when larger than twice the remaining credits', async () => {
      const user = await callerWithCredits()

      await expect(
        UploadsUseCases.createFolderUpload(
          user,
          'folder',
          folderTree(50),
          null,
        ),
      ).rejects.toBeInstanceOf(PaymentRequiredError)
      expect(await uploadsOf(user)).toBe(0)
    })

    it('count toward the bound once stored', async () => {
      const credits = 10_000
      const user = await callerWithCredits(credits)
      await UploadsUseCases.createFolderUpload(
        user,
        'folder',
        folderTree(50),
        null,
      )
      const treeBytes = await unfinishedBytes(user)
      expect(treeBytes).toBeGreaterThan(0)

      const upload = await startUpload(user)
      await sendPart(user, upload.id, 0, 2 * credits - treeBytes)
      await expect(sendPart(user, upload.id, 1, 1)).rejects.toBeInstanceOf(
        PaymentRequiredError,
      )
    })
  })

  // The client is never told the upload id behind a PutObject, so a refused
  // one must not leave its upload behind.
  describe('S3 PutObject', () => {
    const put = (user: UserWithOrganization, bytes: number) =>
      S3UseCases.putObject(user, {
        Bucket: 'bucket',
        Key: 'object.bin',
        Body: Buffer.alloc(bytes, 1),
      })

    it('leaves no upload when its part is refused', async () => {
      const user = await callerWithCredits()

      const result = await put(user, 2 * CREDITS + 1)

      expect(result._unsafeUnwrapErr()).toBeInstanceOf(PaymentRequiredError)
      expect(await uploadsOf(user)).toBe(0)
    })

    it('leaves no upload when its part is stored and completion is refused', async () => {
      const user = await callerWithCredits()

      await expect(put(user, CREDITS + 1)).rejects.toBeInstanceOf(
        PaymentRequiredError,
      )
      expect(await uploadsOf(user)).toBe(0)
    })

    it('keeps the upload of an object that is paid for until it is migrated', async () => {
      const user = await callerWithCredits()

      const result = await put(user, CREDITS)

      expect(result.isOk()).toBe(true)
      expect(await uploadsOf(user)).toBe(1)
      expect(await unfinishedBytes(user)).toBe(0)
    })
  })

  describe('an organisation', () => {
    it('has one bound for all its API keys and one for each member', async () => {
      const organizationId = v4()
      await AccountsUseCases.initAccount(organizationId, CREDITS, 0)
      const organisationKey = (apiKeyId: string): UserWithOrganization => ({
        oauthProvider: SERVICE_USER_PROVIDER,
        oauthUserId: organizationId,
        role: UserRole.User,
        onboarded: true,
        organizationId,
        publicId: v4(),
        apiKeyId,
      })
      const firstKey = organisationKey(v4())
      const secondKey = organisationKey(v4())
      const member = { ...createMockUser(), organizationId }

      await sendPart(firstKey, (await startUpload(firstKey)).id, 0, 150)
      const upload = await startUpload(secondKey)
      await sendPart(secondKey, upload.id, 0, 50)
      await expect(sendPart(secondKey, upload.id, 1, 1)).rejects.toBeInstanceOf(
        PaymentRequiredError,
      )

      await sendPart(member, (await startUpload(member)).id, 0, 2 * CREDITS)
    })
  })
})
