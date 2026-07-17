import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { s3ObjectMappingsRepository } from '../../../src/infrastructure/repositories/s3/objectMappings.js'
import { getDatabase } from '../../../src/infrastructure/drivers/pg.js'
import { dbMigration } from '../../utils/dbMigrate.js'

// Object Lock / versioning read paths must report the current version's write
// time (object_versions.created_at), NOT object_mappings.updated_at — a
// BEFORE UPDATE trigger bumps updated_at on soft-delete/restore without writing
// a new version, so it drifts after a Trash restore. See issue #789 review.
describe('S3 object mappings repository — Last-Modified anchoring', () => {
  beforeAll(async () => {
    await dbMigration.up()
  })

  afterAll(async () => {
    await dbMigration.down()
  })

  const OWNER = 'google'
  const USER = 'objmap-repo-test-user'

  // Pin a version's created_at to a fixed past instant. object_versions has no
  // updated-timestamp trigger, so it stays put — letting us prove the read paths
  // use the version write time rather than the (trigger-bumped) mapping row.
  const pinVersionCreatedAt = async (
    bucket: string,
    key: string,
    cid: string,
    at: Date,
  ) => {
    const db = await getDatabase()
    await db.query({
      text: `
        UPDATE "S3".object_versions SET created_at = $6
        WHERE owner_oauth_provider = $1 AND owner_oauth_user_id = $2
          AND bucket = $3 AND "key" = $4 AND cid = $5
      `,
      values: [OWNER, USER, bucket, key, cid, at],
    })
  }

  it('listObjects reports the version write time, not the trigger-bumped updated_at', async () => {
    const bucket = 'worm-listing'
    const key = 'restore-drift.txt'
    await s3ObjectMappingsRepository.createMapping(
      OWNER,
      USER,
      bucket,
      key,
      'cidA',
      'md5A',
    )

    const writtenAt = new Date('2020-01-01T00:00:00.000Z')
    await pinVersionCreatedAt(bucket, key, 'cidA', writtenAt)

    // Soft-delete + restore each fire the BEFORE UPDATE trigger, bumping
    // object_mappings.updated_at to now without writing a new version.
    await s3ObjectMappingsRepository.softDeleteMapping(OWNER, USER, bucket, key)
    await s3ObjectMappingsRepository.restoreMappingsByCid(OWNER, USER, 'cidA')

    // The mapping's updated_at has drifted (trigger) well past the write time...
    const mapping = await s3ObjectMappingsRepository.findByKey(
      OWNER,
      USER,
      bucket,
      key,
    )
    expect(mapping).not.toBeNull()
    expect(mapping!.updatedAt.getTime()).toBeGreaterThan(writtenAt.getTime())

    // ...but listObjects reports the stable version write time.
    const listed = await s3ObjectMappingsRepository.listObjects(
      OWNER,
      USER,
      bucket,
      key,
      null,
      100,
    )
    const row = listed.find((o) => o.key === key)
    expect(row).toBeDefined()
    expect(row!.lastModified.getTime()).toBe(writtenAt.getTime())
  })
})
