import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { UploadStatus, UploadType } from '@auto-drive/models'
import { uploadsRepository } from '../../../src/infrastructure/repositories/uploads/uploads.js'
import { getDatabase } from '../../../src/infrastructure/drivers/pg.js'
import { dbMigration } from '../../utils/dbMigrate.js'

const UPLOAD_ID = 'age-helper-upload'

describe('Uploads Repository', () => {
  beforeAll(async () => {
    await dbMigration.up()
  })

  afterAll(async () => {
    await dbMigration.down()
  })

  describe('getUploadAgeMs', () => {
    it('returns null for an upload that does not exist', async () => {
      expect(await uploadsRepository.getUploadAgeMs('no-such-upload')).toBeNull()
    })

    // uploads.uploads.updated_at is `timestamp` with NO time zone, and every
    // writer stamps it with NOW() — so the stored value is the database session's
    // local wall clock. node-postgres parses that string in the PROCESS's zone, so
    // `Date.now() - new Date(row.updated_at).getTime()` is off by the offset
    // between the two whenever they disagree: an hour too old under Europe/London
    // in summer (a claim taken seconds ago reads as stale, and abortUpload tears
    // down a live completion), seven hours too young under America/Los_Angeles
    // (nothing is ever stale, so a stranded claim can never be aborted).
    //
    // Nothing pins TZ in the pool, the compose files or the Dockerfile, so the
    // guarantee has to come from the query. Postgres subtracts inside one session,
    // which cancels the zone out: the same 90 minutes, whatever the process thinks
    // the time is.
    it('reports the same age whatever the process time zone is', async () => {
      await uploadsRepository.createUploadEntry(
        UPLOAD_ID,
        UploadType.FILE,
        UploadStatus.COMPLETING,
        'aged.bin',
        null,
        null,
        UPLOAD_ID,
        null,
        'google',
        'user1',
        null,
      )
      const db = await getDatabase()
      await db.query(
        `UPDATE uploads.uploads
         SET updated_at = NOW() - make_interval(mins => 90)
         WHERE id = $1`,
        [UPLOAD_ID],
      )

      const NINETY_MINUTES_MS = 90 * 60 * 1000
      const originalTz = process.env.TZ
      try {
        for (const tz of ['UTC', 'Europe/London', 'America/Los_Angeles']) {
          process.env.TZ = tz

          const ageMs = await uploadsRepository.getUploadAgeMs(UPLOAD_ID)

          expect(ageMs).not.toBeNull()
          // Generous tolerance: this is asserting the absence of a whole-hour
          // skew, not clock precision.
          expect(Math.abs(ageMs! - NINETY_MINUTES_MS)).toBeLessThan(60_000)
        }
      } finally {
        process.env.TZ = originalTz
      }
    })
  })
})
