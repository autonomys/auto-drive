import {
  jest,
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from '@jest/globals'
import { OffchainMetadata } from '@autonomys/auto-dag-data'
import { ObjectTag, UserRole, UserWithOrganization } from '@auto-drive/models'
import { v4 } from 'uuid'
import { ObjectUseCases } from '../../../src/core/index.js'
import { metadataRepository } from '../../../src/infrastructure/repositories/objects/metadata.js'
import { getDatabase } from '../../../src/infrastructure/drivers/pg.js'
import { FileGateway } from '../../../src/infrastructure/services/dsn/fileGateway/index.js'
import { ForbiddenError } from '../../../src/errors/index.js'
import { dbMigration } from '../../utils/dbMigrate.js'
import { createMockUser, mockRabbitPublish } from '../../utils/mocks.js'

const createAdminUser = (): UserWithOrganization => ({
  ...createMockUser(),
  role: UserRole.Admin,
})

const createFileMetadata = (name: string): OffchainMetadata => ({
  totalSize: 100n,
  type: 'file',
  dataCid: v4(),
  totalChunks: 1,
  chunks: [],
  name,
})

/** Inserts a metadata row and returns its head cid. */
const createObject = async (rootCid: string = v4()): Promise<string> => {
  const headCid = v4()
  await metadataRepository.setMetadata(
    rootCid,
    headCid,
    createFileMetadata(`moderation-test-${headCid}`),
  )
  return headCid
}

const getTagsByRoot = async (headCid: string) => {
  const db = await getDatabase()
  const result = await db.query<{ root_cid: string; tags: string[] | null }>({
    text: 'SELECT root_cid, tags FROM metadata WHERE head_cid = $1',
    values: [headCid],
  })
  return result.rows
}

const listToBeReviewed = async (admin: UserWithOrganization) => {
  const result = await ObjectUseCases.getToBeReviewedList(admin, 1000, 0)
  expect(result.isOk()).toBe(true)
  return result._unsafeUnwrap()
}

describe('Object moderation (report / dismiss / ban / unban)', () => {
  const admin = createAdminUser()
  const regularUser = createMockUser()

  let banFileMock: jest.SpiedFunction<typeof FileGateway.banFile>
  let unbanFileMock: jest.SpiedFunction<typeof FileGateway.unbanFile>

  beforeAll(async () => {
    mockRabbitPublish()
    await dbMigration.up()
  })

  afterAll(async () => {
    await dbMigration.down()
  })

  beforeEach(() => {
    banFileMock = jest.spyOn(FileGateway, 'banFile').mockResolvedValue()
    unbanFileMock = jest.spyOn(FileGateway, 'unbanFile').mockResolvedValue()
  })

  describe('reportObject', () => {
    it('tags the object as reported and surfaces it in the review queue', async () => {
      const cid = await createObject()

      await ObjectUseCases.reportObject(cid)

      const metadata = await metadataRepository.getMetadata(cid)
      expect(metadata?.tags).toContain(ObjectTag.ToBeReviewed)
      expect(await listToBeReviewed(admin)).toContain(cid)
    })

    it('re-reporting a dismissed file clears the dismissal and resurfaces it', async () => {
      const cid = await createObject()
      await ObjectUseCases.reportObject(cid)
      const dismissed = await ObjectUseCases.dismissReport(admin, cid)
      expect(dismissed.isOk()).toBe(true)
      expect(await listToBeReviewed(admin)).not.toContain(cid)

      await ObjectUseCases.reportObject(cid)

      const metadata = await metadataRepository.getMetadata(cid)
      expect(metadata?.tags).not.toContain(ObjectTag.ReportDismissed)
      expect(await listToBeReviewed(admin)).toContain(cid)
    })

    it('reporting twice does not duplicate the reported tag', async () => {
      const cid = await createObject()

      await ObjectUseCases.reportObject(cid)
      await ObjectUseCases.reportObject(cid)

      const metadata = await metadataRepository.getMetadata(cid)
      expect(
        metadata?.tags?.filter((tag) => tag === ObjectTag.ToBeReviewed),
      ).toHaveLength(1)
    })

    it('throws for an unknown cid', async () => {
      await expect(ObjectUseCases.reportObject(v4())).rejects.toThrow(
        'Object not found',
      )
    })
  })

  describe('dismissReport', () => {
    it('rejects non-admin users', async () => {
      const cid = await createObject()
      await ObjectUseCases.reportObject(cid)

      const result = await ObjectUseCases.dismissReport(regularUser, cid)

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
    })

    it('tags the object as dismissed and removes it from the review queue', async () => {
      const cid = await createObject()
      await ObjectUseCases.reportObject(cid)

      const result = await ObjectUseCases.dismissReport(admin, cid)

      expect(result.isOk()).toBe(true)
      const metadata = await metadataRepository.getMetadata(cid)
      expect(metadata?.tags).toContain(ObjectTag.ReportDismissed)
      // Regression: the exclude filter must drop rows carrying ANY excluded
      // tag — a dismissed-but-not-banned file must not reappear in the queue.
      expect(await listToBeReviewed(admin)).not.toContain(cid)
    })
  })

  describe('banObject', () => {
    it('rejects non-admin users and does not reach the gateway', async () => {
      const cid = await createObject()

      const result = await ObjectUseCases.banObject(regularUser, cid)

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
      expect(banFileMock).not.toHaveBeenCalled()
    })

    it('tags the object as banned, calls the gateway, and removes it from the review queue', async () => {
      const cid = await createObject()
      await ObjectUseCases.reportObject(cid)

      const result = await ObjectUseCases.banObject(admin, cid)

      expect(result.isOk()).toBe(true)
      expect(banFileMock).toHaveBeenCalledWith(cid)
      const metadata = await metadataRepository.getMetadata(cid)
      expect(metadata?.tags).toContain(ObjectTag.Banned)
      // Regression: banned-but-not-dismissed files must be excluded too.
      expect(await listToBeReviewed(admin)).not.toContain(cid)
    })

    it('banning twice does not duplicate the banned tag', async () => {
      const cid = await createObject()

      await ObjectUseCases.banObject(admin, cid)
      await ObjectUseCases.banObject(admin, cid)

      const metadata = await metadataRepository.getMetadata(cid)
      expect(
        metadata?.tags?.filter((tag) => tag === ObjectTag.Banned),
      ).toHaveLength(1)
    })
  })

  describe('unbanObject', () => {
    it('rejects non-admin users and does not reach the gateway', async () => {
      const cid = await createObject()
      await ObjectUseCases.banObject(admin, cid)

      const result = await ObjectUseCases.unbanObject(regularUser, cid)

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
      expect(unbanFileMock).not.toHaveBeenCalled()
    })

    it('unbans at the gateway and removes the banned tag', async () => {
      const cid = await createObject()
      await ObjectUseCases.banObject(admin, cid)

      const result = await ObjectUseCases.unbanObject(admin, cid)

      expect(result.isOk()).toBe(true)
      expect(unbanFileMock).toHaveBeenCalledWith(cid)
      const metadata = await metadataRepository.getMetadata(cid)
      expect(metadata?.tags).not.toContain(ObjectTag.Banned)
    })

    it('keeps the banned tag when the gateway call fails (fails closed)', async () => {
      const cid = await createObject()
      await ObjectUseCases.banObject(admin, cid)
      unbanFileMock.mockRejectedValue(new Error('gateway unreachable'))

      await expect(ObjectUseCases.unbanObject(admin, cid)).rejects.toThrow(
        'gateway unreachable',
      )

      // The DB must not claim the file is unbanned while the gateway still
      // bans it — otherwise the UI re-enables the file and the gateway's
      // state silently re-tags it later.
      const metadata = await metadataRepository.getMetadata(cid)
      expect(metadata?.tags).toContain(ObjectTag.Banned)
    })
  })

  describe('multi-row objects (same head cid under several roots)', () => {
    it('ban and unban apply to every row of the head cid', async () => {
      // Content dedup can store the same head_cid under several root_cids
      // (e.g. a file uploaded standalone and inside a folder), and rows
      // created later never inherit tags from earlier ones.
      const cid = await createObject()
      await ObjectUseCases.banObject(admin, cid)

      // A new row for the same content appears after the ban, with NULL tags.
      await metadataRepository.setMetadata(
        v4(),
        cid,
        createFileMetadata('moderation-test-nested-copy'),
      )

      await ObjectUseCases.banObject(admin, cid)
      let rows = await getTagsByRoot(cid)
      expect(rows).toHaveLength(2)
      for (const row of rows) {
        expect(
          row.tags?.filter((tag) => tag === ObjectTag.Banned),
        ).toHaveLength(1)
      }

      // Unban must clear the tag on ALL rows, regardless of which row the
      // pre-update read happens to see first.
      const result = await ObjectUseCases.unbanObject(admin, cid)
      expect(result.isOk()).toBe(true)
      rows = await getTagsByRoot(cid)
      for (const row of rows) {
        expect(row.tags ?? []).not.toContain(ObjectTag.Banned)
      }
    })
  })

  describe('getToBeReviewedList', () => {
    it('rejects non-admin users', async () => {
      const result = await ObjectUseCases.getToBeReviewedList(
        regularUser,
        10,
        0,
      )

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr()).toBeInstanceOf(ForbiddenError)
    })

    it('lists only reported files that are neither banned nor dismissed', async () => {
      const pendingCid = await createObject()
      const bannedCid = await createObject()
      const dismissedCid = await createObject()
      const untouchedCid = await createObject()

      await ObjectUseCases.reportObject(pendingCid)
      await ObjectUseCases.reportObject(bannedCid)
      await ObjectUseCases.reportObject(dismissedCid)
      await ObjectUseCases.banObject(admin, bannedCid)
      await ObjectUseCases.dismissReport(admin, dismissedCid)

      const cids = await listToBeReviewed(admin)

      expect(cids).toContain(pendingCid)
      expect(cids).not.toContain(bannedCid)
      expect(cids).not.toContain(dismissedCid)
      expect(cids).not.toContain(untouchedCid)
    })
  })
})
