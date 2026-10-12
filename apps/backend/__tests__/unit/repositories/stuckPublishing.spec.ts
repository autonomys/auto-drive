import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from '@jest/globals'
import {
  nodesRepository,
  Node,
} from '../../../src/infrastructure/repositories/objects/nodes.js'
import { getDatabase } from '../../../src/infrastructure/drivers/pg.js'
import { dbMigration } from '../../utils/dbMigrate.js'

const STALENESS_BLOCKS = 1000
const COOLDOWN_MS = 2 * 60 * 60 * 1000
const CHAIN_HEAD = 100_000

const node = (
  rootCid: string,
  cid: string,
  blockPublishedOn: number | null,
): Node => ({
  cid,
  root_cid: rootCid,
  head_cid: rootCid,
  type: 'file',
  encoded_node: 'ZW5jb2RlZA==',
  block_published_on: blockPublishedOn,
  tx_published_on: blockPublishedOn === null ? null : '0xtx',
  piece_index: null,
  piece_offset: null,
})

// The set_timestamp trigger overwrites updated_at on every UPDATE, so it has
// to be disabled to backdate rows.
const backdate = async (rootCid: string, hoursAgo: number) => {
  const db = await getDatabase()
  await db.query('ALTER TABLE nodes DISABLE TRIGGER set_timestamp')
  await db.query(
    `UPDATE nodes SET updated_at = NOW() - $2 * INTERVAL '1 hour'
     WHERE root_cid = $1`,
    [rootCid, hoursAgo],
  )
  await db.query('ALTER TABLE nodes ENABLE TRIGGER set_timestamp')
}

const getStuck = (limit = 10) =>
  nodesRepository.getStuckPublishingRootCids(
    limit,
    STALENESS_BLOCKS,
    COOLDOWN_MS,
  )

describe('getStuckPublishingRootCids', () => {
  beforeAll(async () => {
    await dbMigration.up()
  })

  afterAll(async () => {
    await dbMigration.down()
  })

  beforeEach(async () => {
    const db = await getDatabase()
    await db.query('DELETE FROM nodes')
    await db.query('DELETE FROM uploads.uploads')
    // Stands in for the chain head (global MAX(block_published_on)).
    await nodesRepository.saveNodes([node('head', 'head-node', CHAIN_HEAD)])
  })

  it('selects an object with zero published nodes once the cooldown has passed', async () => {
    await nodesRepository.saveNodes([node('zero', 'zero-1', null)])
    expect(await getStuck()).toEqual([])

    await backdate('zero', 3)
    expect(await getStuck()).toEqual(['zero'])
  })

  it('still requires a stale published block for partially published objects', async () => {
    await nodesRepository.saveNodes([
      node('active', 'active-1', CHAIN_HEAD - 10),
      node('active', 'active-2', null),
      node('stalled', 'stalled-1', CHAIN_HEAD - STALENESS_BLOCKS - 1),
      node('stalled', 'stalled-2', null),
    ])
    await backdate('active', 3)
    await backdate('stalled', 3)

    expect(await getStuck()).toEqual(['stalled'])
  })

  it('does not select an object again until its cooldown has passed', async () => {
    await nodesRepository.saveNodes([
      node('zero', 'zero-1', null),
      node('partial', 'partial-1', 1),
      node('partial', 'partial-2', null),
    ])
    await backdate('zero', 3)
    await backdate('partial', 3)
    expect((await getStuck()).sort()).toEqual(['partial', 'zero'])

    await nodesRepository.touchUnpublishedNodesByRootCid('zero')
    await nodesRepository.touchUnpublishedNodesByRootCid('partial')
    expect(await getStuck()).toEqual([])
  })

  it('rotates oldest-first so a backlog of one kind cannot starve the other', async () => {
    for (let i = 0; i < 3; i++) {
      await nodesRepository.saveNodes([node(`zero-${i}`, `zero-${i}-1`, null)])
      await backdate(`zero-${i}`, 10 + i)
    }
    await nodesRepository.saveNodes([
      node('partial', 'partial-1', 1),
      node('partial', 'partial-2', null),
    ])
    await backdate('partial', 3)

    const first = await getStuck(2)
    expect(first).toEqual(['zero-2', 'zero-1'])
    for (const rootCid of first) {
      await nodesRepository.touchUnpublishedNodesByRootCid(rootCid)
    }

    expect(await getStuck(2)).toEqual(['zero-0', 'partial'])
  })

  it('skips objects whose migration has not completed', async () => {
    const db = await getDatabase()
    await nodesRepository.saveNodes([node('migrating', 'migrating-1', null)])
    await backdate('migrating', 3)
    await db.query(
      `INSERT INTO uploads.uploads
         (id, type, status, name, oauth_provider, oauth_user_id)
       VALUES ('upload-1', 'file', 'migrating', 'f', 'p', 'u')`,
    )
    await db.query(
      `INSERT INTO uploads.blockstore
         (upload_id, cid, node_type, node_size, data)
       VALUES ('upload-1', 'migrating', 'file', 1, '\\x00')`,
    )

    expect(await getStuck()).toEqual([])
  })

  it('skips objects whose unpublished nodes were all stripped', async () => {
    const db = await getDatabase()
    await nodesRepository.saveNodes([node('stripped', 'stripped-1', null)])
    await db.query('UPDATE nodes SET encoded_node = NULL WHERE root_cid = $1', [
      'stripped',
    ])
    await backdate('stripped', 3)

    expect(await getStuck()).toEqual([])
  })
})
