import { UserWithOrganization } from '@auto-drive/models'
import { jest } from '@jest/globals'
import { ObjectUseCases } from '../../../src/core/objects/object.js'
import { S3UseCases } from '../../../src/core/s3/index.js'
import { UploadsUseCases } from '../../../src/core/uploads/uploads.js'
import { getDatabase } from '../../../src/infrastructure/drivers/pg.js'
import {
  ownershipRepository,
  s3ObjectMappingsRepository,
} from '../../../src/infrastructure/repositories/index.js'
import { dbMigration } from '../../utils/dbMigrate.js'
import { createMockUser, mockRabbitPublish } from '../../utils/mocks.js'

const BUCKET = 'race-bucket'
// The file name is part of the DAG, so identical bytes share a CID only under
// the same name. Two directories give two keys for one piece of content.
const KEY_A = 'a/file.txt'
const KEY_B = 'b/file.txt'

const gate = () => {
  let open!: () => void
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { open, opened }
}

// Pauses the next call of `object[method]` after the real call returns, so the
// test decides what runs before the caller continues.
const holdAfter = <T extends object>(object: T, method: keyof T) => {
  const reached = gate()
  const release = gate()
  const original = object[method] as (...args: unknown[]) => Promise<unknown>
  jest.spyOn(object, method as never).mockImplementationOnce((async (
    ...args: unknown[]
  ) => {
    const result = await original.apply(object, args)
    reached.open()
    await release.opened
    return result
  }) as never)
  return { reached: reached.opened, release: release.open }
}

const waitingAdvisoryLocks = async () => {
  const db = await getDatabase()
  const result = await db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM pg_locks
     WHERE locktype = 'advisory' AND NOT granted`,
  )
  return result.rows[0].count
}

const databaseNow = async () => {
  const db = await getDatabase()
  const result = await db.query<{ now: Date }>(
    'SELECT clock_timestamp()::timestamp AS now',
  )
  return result.rows[0].now
}

// Resolves once `operation` has either finished or is queued behind a lock, so
// the test can resume the other side without guessing how long either takes.
const settledOrBlocked = async (operation: Promise<unknown>) => {
  let settled = false
  operation.then(
    () => (settled = true),
    () => (settled = true),
  )
  while (!settled && (await waitingAdvisoryLocks()) === 0) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('S3 DeleteObject racing a write of the same content', () => {
  let user: UserWithOrganization

  beforeAll(async () => {
    await dbMigration.up()
  })

  beforeEach(() => {
    mockRabbitPublish()
    jest.spyOn(ObjectUseCases, 'syncingIsObjectBanned').mockResolvedValue(false)
    user = createMockUser()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  afterAll(async () => {
    await dbMigration.down()
  })

  const put = (key: string, body: string) =>
    S3UseCases.putObject(user, {
      Bucket: BUCKET,
      Key: key,
      Body: Buffer.from(body),
    }).then((result) => result._unsafeUnwrap())

  const multipartPut = async (key: string, body: string) => {
    const { UploadId } = (
      await S3UseCases.createMultipartUpload(user, { Bucket: BUCKET, Key: key })
    )._unsafeUnwrap()
    const { ETag } = (
      await S3UseCases.uploadPart(user, {
        Bucket: BUCKET,
        Key: key,
        UploadId,
        PartNumber: 1,
        Body: Buffer.from(body),
      })
    )._unsafeUnwrap()
    return (
      await S3UseCases.completeMultipartUpload(user, {
        Bucket: BUCKET,
        Key: key,
        UploadId,
        Parts: [{ PartNumber: 1, ETag }],
      })
    )._unsafeUnwrap()
  }

  const readable = async (key: string) =>
    (await S3UseCases.getObject(user, { Bucket: BUCKET, Key: key })).isOk()

  const remove = (key: string) => S3UseCases.deleteObject(user, BUCKET, key)

  it.each([
    ['PutObject', put],
    ['CompleteMultipartUpload', multipartPut],
  ])(
    '%s stays readable when a delete trashes the same content after the upload finalized',
    async (_, write) => {
      const content = `finalized-then-trashed ${_}`
      const { Cid: cid } = await put(KEY_A, content)

      const hold = holdAfter(UploadsUseCases, 'completeUpload')
      const writing = write(KEY_B, content)
      await hold.reached

      await remove(KEY_A)
      hold.release()

      expect((await writing).Cid).toBe(cid)
      expect(await readable(KEY_B)).toBe(true)
      expect(await readable(KEY_A)).toBe(false)
      expect(await ObjectUseCases.isObjectDeleted(cid)).toBe(false)
    },
  )

  it('PutObject stays readable when it lands between a delete counting keys and trashing', async () => {
    const content = 'counted-then-written'
    const { Cid: cid } = await put(KEY_A, content)

    const hold = holdAfter(
      s3ObjectMappingsRepository,
      'countActiveMappingsByCid',
    )
    const deleting = remove(KEY_A)
    await hold.reached

    const writing = put(KEY_B, content)
    await settledOrBlocked(writing)
    hold.release()

    await deleting
    expect((await writing).Cid).toBe(cid)
    expect(await readable(KEY_B)).toBe(true)
    expect(await readable(KEY_A)).toBe(false)
    expect(await ObjectUseCases.isObjectDeleted(cid)).toBe(false)
  })

  it('dates a write that waited for a delete from when it ran, not from when it began waiting', async () => {
    const content = 'waited-then-written'
    const { Cid: cid } = await put(KEY_A, content)

    const hold = holdAfter(
      s3ObjectMappingsRepository,
      'countActiveMappingsByCid',
    )
    const deleting = remove(KEY_A)
    await hold.reached

    const writing = put(KEY_B, content)
    await settledOrBlocked(writing)
    const waitingSince = await databaseNow()
    hold.release()
    await Promise.all([deleting, writing])

    const version = await s3ObjectMappingsRepository.findVersionByCid(
      user.oauthProvider,
      user.oauthUserId,
      BUCKET,
      KEY_B,
      cid,
    )
    expect(version!.createdAt.getTime()).toBeGreaterThan(waitingSince.getTime())
  })

  it('lets two writes of the same content run at the same time', async () => {
    const content = 'written-twice-at-once'
    const hold = holdAfter(s3ObjectMappingsRepository, 'createMapping')
    const first = put(KEY_A, content)
    await hold.reached

    const second = put(KEY_B, content)
    try {
      await settledOrBlocked(second)
      expect(await waitingAdvisoryLocks()).toBe(0)
    } finally {
      hold.release()
    }

    const [a, b] = await Promise.all([first, second])
    expect(b.Cid).toBe(a.Cid)
    expect(await readable(KEY_A)).toBe(true)
    expect(await readable(KEY_B)).toBe(true)
  })

  it('CopyObject stays readable when a delete of its source trashes the content mid-copy', async () => {
    const content = 'copied-while-deleted'
    const { Cid: cid } = await put(KEY_A, content)

    const hold = holdAfter(ObjectUseCases, 'authorizeDownload')
    const copying = S3UseCases.copyObject(user, {
      SourceBucket: BUCKET,
      SourceKey: KEY_A,
      Bucket: BUCKET,
      Key: KEY_B,
    })
    await hold.reached

    await remove(KEY_A)
    hold.release()

    expect((await copying)._unsafeUnwrap().Cid).toBe(cid)
    expect(await readable(KEY_B)).toBe(true)
    expect(await ObjectUseCases.isObjectDeleted(cid)).toBe(false)
  })

  it('still trashes the content when two keys for it are deleted at once', async () => {
    const content = 'both-deleted'
    const { Cid: cid } = await put(KEY_A, content)
    await put(KEY_B, content)

    const hold = holdAfter(
      s3ObjectMappingsRepository,
      'countActiveMappingsByCid',
    )
    const first = remove(KEY_A)
    await hold.reached

    const second = remove(KEY_B)
    await settledOrBlocked(second)
    hold.release()

    await Promise.all([first, second])
    expect(await readable(KEY_A)).toBe(false)
    expect(await readable(KEY_B)).toBe(false)
    expect(await ObjectUseCases.isObjectDeleted(cid)).toBe(true)
  })

  it('moves the content to Trash on deleting its last key; restoring brings the content back but not the key', async () => {
    const content = 'trash-and-restore'
    const { Cid: cid } = await put(KEY_A, content)

    const deleted = (await remove(KEY_A))._unsafeUnwrap()

    expect(deleted.deleteMarker).toBe(true)
    expect(await ObjectUseCases.isObjectDeleted(cid)).toBe(true)

    expect((await ObjectUseCases.restoreObject(user, cid)).isOk()).toBe(true)
    expect(await ObjectUseCases.isObjectDeleted(cid)).toBe(false)
    expect(await readable(KEY_A)).toBe(false)

    const copied = await S3UseCases.copyObject(user, {
      SourceBucket: BUCKET,
      SourceKey: KEY_A,
      SourceVersionId: cid,
      Bucket: BUCKET,
      Key: KEY_A,
    })
    expect(copied.isOk()).toBe(true)
    expect(await readable(KEY_A)).toBe(true)
  })

  // The web-app Trash is stamped by the app clock and a DeleteObject by the
  // database clock. Moving the Trash time a minute back puts the delete after
  // it whatever the skew between the two.
  const backdateTrash = async (cid: string) => {
    const db = await getDatabase()
    await db.query({
      text: `UPDATE object_ownership
             SET marked_as_deleted = marked_as_deleted - interval '1 minute'
             WHERE cid = $1 AND oauth_provider = $2 AND oauth_user_id = $3`,
      values: [cid, user.oauthProvider, user.oauthUserId],
    })
  }

  it('restoring from Trash leaves hidden a key deleted while its content was in Trash', async () => {
    const content = 'deleted-while-trashed'
    const { Cid: cid } = await put(KEY_A, content)
    expect((await ObjectUseCases.markAsDeleted(user, cid)).isOk()).toBe(true)
    await backdateTrash(cid)

    expect((await remove(KEY_A))._unsafeUnwrap().deleteMarker).toBe(true)
    expect((await ObjectUseCases.restoreObject(user, cid)).isOk()).toBe(true)

    expect(await ObjectUseCases.isObjectDeleted(cid)).toBe(false)
    expect(await readable(KEY_A)).toBe(false)
  })

  it('restoring from Trash brings back the other keys but not one deleted while in Trash', async () => {
    const content = 'one-of-two-deleted-while-trashed'
    const { Cid: cid } = await put(KEY_A, content)
    await put(KEY_B, content)
    expect((await ObjectUseCases.markAsDeleted(user, cid)).isOk()).toBe(true)
    await backdateTrash(cid)

    expect((await remove(KEY_A))._unsafeUnwrap().deleteMarker).toBe(true)
    expect((await ObjectUseCases.restoreObject(user, cid)).isOk()).toBe(true)

    expect(await readable(KEY_B)).toBe(true)
    expect(await readable(KEY_A)).toBe(false)
  })

  it('a delete during a restore from Trash does not leave the deleted key to come back on a later write', async () => {
    const content = 'restored-while-deleted'
    const { Cid: cid } = await put(KEY_A, content)
    expect((await ObjectUseCases.markAsDeleted(user, cid)).isOk()).toBe(true)

    const hold = holdAfter(ownershipRepository, 'updateDeletedAt')
    const restoring = ObjectUseCases.restoreObject(user, cid)
    await hold.reached

    const deleting = remove(KEY_A)
    await settledOrBlocked(deleting)
    hold.release()
    await Promise.all([restoring, deleting])

    expect(await readable(KEY_A)).toBe(false)
    expect(await ObjectUseCases.isObjectDeleted(cid)).toBe(true)

    await put(KEY_B, content)
    expect(await readable(KEY_B)).toBe(true)
    expect(await readable(KEY_A)).toBe(false)
  })
})
