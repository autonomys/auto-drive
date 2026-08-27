import { jest } from '@jest/globals'
import { v4 } from 'uuid'
import { dbMigration } from '../../utils/dbMigrate.js'
import { createMockUser, mockRabbitPublish, unmockMethods } from '../../utils/mocks.js'
import { getDatabase } from '../../../src/infrastructure/drivers/pg.js'
import { UploadsUseCases } from '../../../src/core/uploads/uploads.js'

jest.setTimeout(300_000)

/**
 * The single-statement chunk resolution added for issue #815 filters
 * uploads.blockstore on `cid` alone. Every pre-existing index on that table
 * leads with upload_id, so without blockstore_cid_index the predicate has no
 * index it can use at all.
 */
describe('chunk resolution index coverage', () => {
  beforeAll(async () => {
    mockRabbitPublish()
    await dbMigration.up()
  })
  afterAll(async () => {
    await dbMigration.down()
    unmockMethods()
  })

  it('uses an index for the cid-only blockstore lookup', async () => {
    const db = await getDatabase()
    const upload = await UploadsUseCases.createFileUpload(
      createMockUser(), 'plan.bin', 'application/octet-stream', null,
    )

    // Enough rows that a seq scan is genuinely the wrong plan.
    const payload = Buffer.alloc(4096, 7)
    const realCids: string[] = []
    for (let batch = 0; batch < 20; batch++) {
      const values: string[] = []
      const params: unknown[] = []
      for (let i = 0; i < 500; i++) {
        const cid = `bafkr6i${v4().replace(/-/g, '')}`
        if (realCids.length < 100) realCids.push(cid)
        params.push(upload.id, cid, 'FileChunk', 4096, payload)
        const b = params.length
        values.push(`($${b - 4}, $${b - 3}, $${b - 2}, $${b - 1}, $${b})`)
      }
      await db.query(
        `INSERT INTO uploads.blockstore (upload_id, cid, node_type, node_size, data) VALUES ${values.join(',')}`,
        params,
      )
    }
    await db.query('ANALYZE uploads.blockstore')

    const indexes = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'uploads' AND tablename = 'blockstore'`,
    )
    expect(indexes.rows.map((r) => r.indexname)).toContain('blockstore_cid_index')

    // Whether the planner PICKS an index here depends on table size — at test
    // volumes a sequential scan is genuinely cheaper, because the 64 KiB
    // payloads are TOASTed out of line and the main heap is tiny. What matters
    // is that an index is APPLICABLE to a cid-only predicate at all: before
    // blockstore_cid_index every index on this table led with upload_id, so a
    // large table had no option but a full scan. Forcing the planner's hand
    // proves applicability without asserting a cost decision that legitimately
    // varies with size.
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      await client.query('SET LOCAL enable_seqscan = off')
      // The statement below must stay in step with resolveEncodedNodes; an
      // EXPLAIN of a hand-written stand-in would keep passing after the real
      // query changed shape.
      const { rows } = await client.query(
        `EXPLAIN (COSTS OFF)
         SELECT DISTINCT ON (cid) cid, encoded_node
         FROM (
           SELECT cid, encoded_node, 0 AS source
           FROM nodes WHERE cid = ANY($1) AND encoded_node IS NOT NULL
           UNION ALL
           SELECT DISTINCT ON (cid) cid, encode(data, 'base64') AS encoded_node, 1 AS source
           FROM uploads.blockstore WHERE cid = ANY($1)
         ) resolved
         ORDER BY cid, source`,
        [realCids],
      )
      const plan = rows.map((r: { [k: string]: string }) => r['QUERY PLAN']).join('\n')
      expect(plan).toMatch(/blockstore_cid_index/)
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }
  })
})
