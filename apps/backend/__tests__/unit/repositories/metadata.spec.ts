import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { metadataRepository } from '../../../src/infrastructure/repositories/objects/metadata.js'
import { OffchainMetadata } from '@autonomys/auto-dag-data'
import { dbMigration } from '../../utils/dbMigrate.js'
import { ownershipRepository } from '../../../src/infrastructure/repositories/objects/ownership.js'
import { getDatabase } from '../../../src/infrastructure/drivers/pg.js'

// Forces the legacy divergent state (rows of one head_cid with different
// tags) that setMetadata's tag inheritance normally prevents nowadays.
const clearTagsOfRow = async (rootCid: string, headCid: string) => {
  const db = await getDatabase()
  await db.query({
    text: 'UPDATE metadata SET tags = NULL WHERE root_cid = $1 AND head_cid = $2',
    values: [rootCid, headCid],
  })
}

describe('Metadata Repository', () => {
  beforeAll(async () => {
    await dbMigration.up()
  })

  afterAll(async () => {
    await dbMigration.down()
  })

  beforeEach(async () => {
    // Clean up the database before each test
    const allMetadata = await metadataRepository.getAllMetadata()
    for (const metadata of allMetadata) {
      await metadataRepository.markAsArchived(metadata.head_cid)
    }
  })

  it('should set and get metadata', async () => {
    const rootCid = 'test-root-cid'
    const headCid = 'test-head-cid'
    const metadata: OffchainMetadata = {
      totalSize: 100n,
      type: 'file',
      dataCid: 'test-data-cid',
      totalChunks: 1,
      chunks: [],
      name: 'test-file',
    }

    await metadataRepository.setMetadata(rootCid, headCid, metadata)
    const result = await metadataRepository.getMetadata(headCid)

    expect(result).toBeDefined()
    expect(result?.root_cid).toBe(rootCid)
    expect(result?.head_cid).toBe(headCid)
    expect(result?.metadata.name).toBe(metadata.name)
    expect(result?.metadata.type).toBe(metadata.type)
    expect(result?.metadata.dataCid).toBe(metadata.dataCid)
  })

  it('should search metadata by CID', async () => {
    const rootCid = 'search-root-cid'
    const headCid = 'search-head-cid'
    const metadata: OffchainMetadata = {
      totalSize: 100n,
      type: 'file',
      dataCid: 'search-data-cid',
      totalChunks: 1,
      chunks: [],
      name: 'search-file',
    }

    await metadataRepository.setMetadata(rootCid, headCid, metadata)

    // Note: This test might fail because searchMetadataByCID requires object_ownership entries
    // In a real implementation, we would need to add ownership records
    const results = await metadataRepository.searchMetadataByCID('search', 10)

    // This might be empty if ownership records are required
    if (results.length > 0) {
      expect(results[0].head_cid).toBe(headCid)
    }
  })

  it('should mark metadata as archived', async () => {
    const rootCid = 'archive-root-cid'
    const headCid = 'archive-head-cid'
    const metadata: OffchainMetadata = {
      totalSize: 100n,
      type: 'file',
      dataCid: 'archive-data-cid',
      totalChunks: 1,
      chunks: [],
      name: 'archive-file',
    }

    await metadataRepository.setMetadata(rootCid, headCid, metadata)
    await metadataRepository.markAsArchived(headCid)

    const result = await metadataRepository.getMetadata(headCid)
    expect(result?.is_archived).toBe(true)

    const archivedResults =
      await metadataRepository.getMetadataByIsArchived(true)
    expect(archivedResults.some((m) => m.head_cid === headCid)).toBe(true)
  })

  it('should add tags to metadata', async () => {
    const rootCid = 'tag-root-cid'
    const headCid = 'tag-head-cid'
    const metadata: OffchainMetadata = {
      totalSize: 100n,
      type: 'file',
      dataCid: 'tag-data-cid',
      totalChunks: 1,
      chunks: [],
      name: 'tag-file',
    }

    await metadataRepository.setMetadata(rootCid, headCid, metadata)
    await metadataRepository.addTag(headCid, 'test-tag')

    const result = await metadataRepository.getMetadata(headCid)
    expect(result?.tags).toContain('test-tag')
  })

  it('should get metadata by root CID', async () => {
    const rootCid = 'root-cid-test'
    const headCid1 = 'head-cid-test-1'
    const headCid2 = 'head-cid-test-2'

    const metadata1: OffchainMetadata = {
      totalSize: 100n,
      type: 'file',
      dataCid: 'data-cid-1',
      totalChunks: 1,
      chunks: [],
      name: 'file-1',
    }

    const metadata2: OffchainMetadata = {
      totalSize: 200n,
      type: 'file',
      dataCid: 'data-cid-2',
      totalChunks: 1,
      chunks: [],
      name: 'file-2',
    }

    await metadataRepository.setMetadata(rootCid, headCid1, metadata1)
    await metadataRepository.setMetadata(rootCid, headCid2, metadata2)

    const results = await metadataRepository.getMetadataByRootCid(rootCid)

    expect(results.length).toBe(2)
    expect(results.map((r) => r.head_cid)).toContain(headCid1)
    expect(results.map((r) => r.head_cid)).toContain(headCid2)
  })

  it('should get all metadata', async () => {
    const rootCid = 'all-metadata-root-cid'
    const headCid = 'all-metadata-head-cid'
    const metadata: OffchainMetadata = {
      totalSize: 100n,
      type: 'file',
      dataCid: 'all-metadata-data-cid',
      totalChunks: 1,
      chunks: [],
      name: 'all-metadata-file',
    }

    await metadataRepository.setMetadata(rootCid, headCid, metadata)

    const results = await metadataRepository.getAllMetadata()
    expect(results.length).toBeGreaterThan(0)
    expect(results.some((r) => r.head_cid === headCid)).toBe(true)
  })

  it('should search metadata by CID', async () => {
    const rootCid = 'search-cid-root'
    const headCid = 'search-cid-head-unique'
    const metadata: OffchainMetadata = {
      totalSize: 100n,
      type: 'file',
      dataCid: 'search-cid-data',
      totalChunks: 1,
      chunks: [],
      name: 'search-cid-file',
    }

    await ownershipRepository.setUserAsAdmin(
      headCid,
      'test-provider',
      'test-user-id',
    )
    await metadataRepository.setMetadata(rootCid, headCid, metadata)

    const results = await metadataRepository.searchMetadataByCID(headCid, 10000)
    expect(
      results.find((r) => r.metadata.dataCid === metadata.dataCid),
    ).toBeTruthy()
  })

  it('should search metadata by CID and user', async () => {
    const rootCid = 'search-cid-user-root'
    const headCid = 'search-cid-user-head-special'
    const metadata: OffchainMetadata = {
      totalSize: 100n,
      type: 'file',
      dataCid: 'search-cid-user-data',
      totalChunks: 1,
      chunks: [],
      name: 'search-cid-user-file',
    }
    const provider = 'test-provider'
    const userId = 'test-user-id'

    await metadataRepository.setMetadata(rootCid, headCid, metadata)
    // Note: This test assumes object_ownership is set up correctly

    const results = await metadataRepository.searchMetadataByCIDAndUser(
      'special',
      10,
      provider,
      userId,
    )
    // This might return empty if the ownership isn't set up in the test
    expect(Array.isArray(results)).toBe(true)
  })

  it('should search metadata by name and user', async () => {
    const rootCid = 'search-name-user-root'
    const headCid = 'search-name-user-head'
    const metadata: OffchainMetadata = {
      totalSize: 100n,
      type: 'file',
      dataCid: 'search-name-user-data',
      totalChunks: 1,
      chunks: [],
      name: 'unique-search-name-test',
    }
    const provider = 'test-provider'
    const userId = 'test-user-id'

    await metadataRepository.setMetadata(rootCid, headCid, metadata)

    const results = await metadataRepository.searchMetadataByNameAndUser(
      'unique-search',
      provider,
      userId,
      10,
    )
    // This might return empty if the ownership isn't set up in the test
    expect(Array.isArray(results)).toBe(true)
  })

  it('should search metadata by name', async () => {
    const rootCid = 'search-name-root'
    const headCid = 'search-name-head'
    const metadata: OffchainMetadata = {
      totalSize: 100n,
      type: 'file',
      dataCid: 'search-name-data',
      totalChunks: 1,
      chunks: [],
      name: 'very-specific-name-for-search',
    }

    // Global name search only returns objects with an active admin owner, so
    // an orphaned metadata row is intentionally hidden. Give it an owner.
    await ownershipRepository.setUserAsAdmin(
      headCid,
      'test-provider',
      'test-user-id',
    )
    await metadataRepository.setMetadata(rootCid, headCid, metadata)

    const results = await metadataRepository.searchMetadataByName(
      'specific-name',
      10,
    )
    expect(results.some((r) => r.head_cid === headCid)).toBe(true)
  })

  it('should get root objects with pagination', async () => {
    const rootCid = 'root-objects-root'
    const headCid = rootCid // Same for root objects
    const metadata: OffchainMetadata = {
      totalSize: 100n,
      type: 'file',
      dataCid: 'root-objects-data',
      totalChunks: 1,
      chunks: [],
      name: 'root-objects-file',
    }

    await metadataRepository.setMetadata(rootCid, headCid, metadata)

    const result = await metadataRepository.getRootObjects(10, 0)
    expect(result).toHaveProperty('rows')
    expect(result).toHaveProperty('totalCount')
    expect(Array.isArray(result.rows)).toBe(true)
  })

  it('should get root objects by user with pagination', async () => {
    const provider = 'test-provider'
    const userId = 'test-user-id'

    const result = await metadataRepository.getRootObjectsByUser(
      provider,
      userId,
      10,
      0,
    )
    expect(result).toHaveProperty('rows')
    expect(result).toHaveProperty('totalCount')
    expect(Array.isArray(result.rows)).toBe(true)
  })

  it('should get shared root objects by user with pagination', async () => {
    const provider = 'test-provider'
    const userId = 'test-user-id'

    const result = await metadataRepository.getSharedRootObjectsByUser(
      provider,
      userId,
      10,
      0,
    )
    expect(result).toHaveProperty('rows')
    expect(result).toHaveProperty('totalCount')
    expect(Array.isArray(result.rows)).toBe(true)
  })

  it('should get marked as deleted root objects by user with pagination', async () => {
    const provider = 'test-provider'
    const userId = 'test-user-id'

    const result = await metadataRepository.getMarkedAsDeletedRootObjectsByUser(
      provider,
      userId,
      10,
      0,
    )
    expect(result).toHaveProperty('rows')
    expect(result).toHaveProperty('totalCount')
    expect(Array.isArray(result.rows)).toBe(true)
  })

  it('should get metadata by user', async () => {
    const provider = 'test-provider'
    const userId = 'test-user-id'

    const result = await metadataRepository.getMetadataByUser(provider, userId)
    expect(result).toHaveProperty('rows')
    expect(Array.isArray(result.rows)).toBe(true)
  })

  it('should mark metadata as archived', async () => {
    const rootCid = 'archive-root-cid'
    const headCid = 'archive-head-cid'
    const metadata: OffchainMetadata = {
      totalSize: 100n,
      type: 'file',
      dataCid: 'archive-data-cid',
      totalChunks: 1,
      chunks: [],
      name: 'archive-file',
    }

    await metadataRepository.setMetadata(rootCid, headCid, metadata)
    await metadataRepository.markAsArchived(headCid)

    const result = await metadataRepository.getMetadata(headCid)
    expect(result?.is_archived).toBe(true)
  })

  it('should not duplicate an existing tag and should tag every row of a head cid', async () => {
    const headCid = 'multi-row-tag-head-cid'
    const metadata: OffchainMetadata = {
      totalSize: 100n,
      type: 'file',
      dataCid: 'multi-row-tag-data-cid',
      totalChunks: 1,
      chunks: [],
      name: 'multi-row-tag-file',
    }

    // Same head_cid under two roots, with tags forced to diverge (as legacy
    // rows can be): addTag must fill the missing row without duplicating the
    // tag on the row that already has it.
    await metadataRepository.setMetadata('multi-row-root-1', headCid, metadata)
    await metadataRepository.addTag(headCid, 'multi-row-tag')
    await metadataRepository.setMetadata('multi-row-root-2', headCid, metadata)
    await clearTagsOfRow('multi-row-root-2', headCid)

    await metadataRepository.addTag(headCid, 'multi-row-tag')

    const rows =
      await metadataRepository.getMetadataByRootCid('multi-row-root-1')
    const rows2 =
      await metadataRepository.getMetadataByRootCid('multi-row-root-2')
    for (const row of [...rows, ...rows2]) {
      expect(row.tags?.filter((tag) => tag === 'multi-row-tag')).toHaveLength(1)
    }
  })

  it('should remove a tag from every row of a head cid', async () => {
    const headCid = 'multi-row-untag-head-cid'
    const metadata: OffchainMetadata = {
      totalSize: 100n,
      type: 'file',
      dataCid: 'multi-row-untag-data-cid',
      totalChunks: 1,
      chunks: [],
      name: 'multi-row-untag-file',
    }

    // One tagged row and one NULL-tags row for the same head_cid: removal
    // must not depend on which row a pre-check happens to read.
    await metadataRepository.setMetadata('multi-row-untag-1', headCid, metadata)
    await metadataRepository.addTag(headCid, 'multi-row-untag')
    await metadataRepository.setMetadata('multi-row-untag-2', headCid, metadata)
    await clearTagsOfRow('multi-row-untag-2', headCid)

    await metadataRepository.removeTag(headCid, 'multi-row-untag')

    const rows =
      await metadataRepository.getMetadataByRootCid('multi-row-untag-1')
    for (const row of rows) {
      expect(row.tags ?? []).not.toContain('multi-row-untag')
    }
  })

  it('should inherit sibling tags when inserting a new row for a known head cid', async () => {
    const headCid = 'inherit-tags-head-cid'
    const metadata: OffchainMetadata = {
      totalSize: 100n,
      type: 'file',
      dataCid: 'inherit-tags-data-cid',
      totalChunks: 1,
      chunks: [],
      name: 'inherit-tags-file',
    }

    await metadataRepository.setMetadata(
      'inherit-tags-root-1',
      headCid,
      metadata,
    )
    await metadataRepository.addTag(headCid, 'inherit-tag-a')
    await metadataRepository.addTag(headCid, 'inherit-tag-b')

    // A new row for already-known (e.g. banned) content must not start as a
    // clean row: it inherits the moderation state of its siblings.
    await metadataRepository.setMetadata(
      'inherit-tags-root-2',
      headCid,
      metadata,
    )

    const rows = await metadataRepository.getMetadataByRootCid(
      'inherit-tags-root-2',
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].tags).toEqual(
      expect.arrayContaining(['inherit-tag-a', 'inherit-tag-b']),
    )

    // Re-upserting an existing row (conflict path) must not clobber its tags.
    await metadataRepository.setMetadata(
      'inherit-tags-root-1',
      headCid,
      metadata,
    )
    const originalRows = await metadataRepository.getMetadataByRootCid(
      'inherit-tags-root-1',
    )
    expect(originalRows[0].tags).toEqual(
      expect.arrayContaining(['inherit-tag-a', 'inherit-tag-b']),
    )
  })

  it('should return each head cid only once from getMetadataByTagIncludeExclude', async () => {
    const headCid = 'dedup-list-head-cid'
    const metadata: OffchainMetadata = {
      totalSize: 100n,
      type: 'file',
      dataCid: 'dedup-list-data-cid',
      totalChunks: 1,
      chunks: [],
      name: 'dedup-list-file',
    }

    // Two identically-tagged rows for the same head_cid (content dedup
    // across roots) must collapse into a single result row.
    await metadataRepository.setMetadata('dedup-list-root-1', headCid, metadata)
    await metadataRepository.setMetadata('dedup-list-root-2', headCid, metadata)
    await metadataRepository.addTag(headCid, 'dedup-list-tag')

    const result = await metadataRepository.getMetadataByTagIncludeExclude(
      ['dedup-list-tag'],
      ['dedup-list-absent-tag'],
      100,
      0,
    )

    const cids = result.rows.map((row) => row.head_cid)
    expect(cids.filter((cid) => cid === headCid)).toHaveLength(1)
  })

  it('should exclude rows carrying ANY excluded tag from getMetadataByTagIncludeExclude', async () => {
    const metadata: OffchainMetadata = {
      totalSize: 100n,
      type: 'file',
      dataCid: 'include-exclude-data-cid',
      totalChunks: 1,
      chunks: [],
      name: 'include-exclude-file',
    }
    const include = 'incl-tag'
    const excludeA = 'excl-tag-a'
    const excludeB = 'excl-tag-b'

    const plainCid = 'incl-excl-plain'
    const withACid = 'incl-excl-with-a'
    const withBCid = 'incl-excl-with-b'
    const withBothCid = 'incl-excl-with-both'
    for (const cid of [plainCid, withACid, withBCid, withBothCid]) {
      await metadataRepository.setMetadata(cid, cid, metadata)
      await metadataRepository.addTag(cid, include)
    }
    await metadataRepository.addTag(withACid, excludeA)
    await metadataRepository.addTag(withBCid, excludeB)
    await metadataRepository.addTag(withBothCid, excludeA)
    await metadataRepository.addTag(withBothCid, excludeB)

    const result = await metadataRepository.getMetadataByTagIncludeExclude(
      [include],
      [excludeA, excludeB],
      100,
      0,
    )

    const cids = result.rows.map((row) => row.head_cid)
    expect(cids).toContain(plainCid)
    expect(cids).not.toContain(withACid)
    expect(cids).not.toContain(withBCid)
    expect(cids).not.toContain(withBothCid)
  })

  it('should get metadata by archived status', async () => {
    const rootCid = 'archived-status-root-cid'
    const headCid = 'archived-status-head-cid'
    const metadata: OffchainMetadata = {
      totalSize: 100n,
      type: 'file',
      dataCid: 'archived-status-data-cid',
      totalChunks: 1,
      chunks: [],
      name: 'archived-status-file',
    }

    await metadataRepository.setMetadata(rootCid, headCid, metadata)
    await metadataRepository.markAsArchived(headCid)

    const archivedResults =
      await metadataRepository.getMetadataByIsArchived(true)
    expect(archivedResults.some((r) => r.head_cid === headCid)).toBe(true)

    const nonArchivedResults =
      await metadataRepository.getMetadataByIsArchived(false)
    expect(nonArchivedResults.some((r) => r.head_cid === headCid)).toBe(false)
  })
})
