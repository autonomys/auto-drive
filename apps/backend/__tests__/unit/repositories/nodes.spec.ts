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
import { dbMigration } from '../../utils/dbMigrate.js'
import { MetadataType } from '@autonomys/auto-dag-data'

describe('Nodes Repository', () => {
  beforeAll(async () => {
    await dbMigration.up()
  })

  afterAll(async () => {
    await dbMigration.down()
  })

  beforeEach(async () => {
    // Clean up the database before each test
    const nodes = await nodesRepository.getNodesByRootCid('test-root-cid')
    for (const node of nodes) {
      await nodesRepository.removeNodeByRootCid(node.root_cid)
    }
  })

  it('should save and get a node', async () => {
    const node: Node = {
      cid: 'test-cid',
      root_cid: 'test-root-cid',
      head_cid: 'test-head-cid',
      type: 'file',
      encoded_node: 'test-encoded-node',
      piece_index: null,
      piece_offset: null,
      block_published_on: null,
      tx_published_on: null,
    }

    await nodesRepository.saveNode(node)
    const result = await nodesRepository.getNode(node.cid)

    expect(result).toBeDefined()
    expect(result?.cid).toBe(node.cid)
    expect(result?.root_cid).toBe(node.root_cid)
    expect(result?.head_cid).toBe(node.head_cid)
    expect(result?.type).toBe(node.type)
    expect(result?.encoded_node).toBe(node.encoded_node)
  })

  it('should save multiple nodes at once', async () => {
    const nodes: Node[] = [
      {
        cid: 'test-cid-1',
        root_cid: 'test-root-cid',
        head_cid: 'test-head-cid-1',
        type: 'file',
        encoded_node: 'test-encoded-node-1',
        piece_index: null,
        piece_offset: null,
        block_published_on: null,
        tx_published_on: null,
      },
      {
        cid: 'test-cid-2',
        root_cid: 'test-root-cid',
        head_cid: 'test-head-cid-2',
        type: 'file',
        encoded_node: 'test-encoded-node-2',
        piece_index: null,
        piece_offset: null,
        block_published_on: null,
        tx_published_on: null,
      },
    ]

    await nodesRepository.saveNodes(nodes)

    const result1 = await nodesRepository.getNode(nodes[0].cid)
    const result2 = await nodesRepository.getNode(nodes[1].cid)

    expect(result1).toBeDefined()
    expect(result2).toBeDefined()
    expect(result1?.cid).toBe(nodes[0].cid)
    expect(result2?.cid).toBe(nodes[1].cid)
  })

  it('should get nodes by head CID', async () => {
    const headCid = 'test-head-cid-for-query'
    const nodes: Node[] = [
      {
        cid: 'test-cid-3',
        root_cid: 'test-root-cid',
        head_cid: headCid,
        type: 'file',
        encoded_node: 'test-encoded-node-3',
        piece_index: null,
        piece_offset: null,
        block_published_on: null,
        tx_published_on: null,
      },
      {
        cid: 'test-cid-4',
        root_cid: 'test-root-cid',
        head_cid: headCid,
        type: 'file',
        encoded_node: 'test-encoded-node-4',
        piece_index: null,
        piece_offset: null,
        block_published_on: null,
        tx_published_on: null,
      },
    ]

    await nodesRepository.saveNodes(nodes)

    const results = await nodesRepository.getNodesByHeadCid(headCid)

    expect(results.length).toBe(2)
    expect(results.map((r) => r.cid)).toContain(nodes[0].cid)
    expect(results.map((r) => r.cid)).toContain(nodes[1].cid)
  })

  it('should get nodes by root CID', async () => {
    const rootCid = 'test-root-cid-for-query'
    const nodes: Node[] = [
      {
        cid: 'test-cid-5',
        root_cid: rootCid,
        head_cid: 'test-head-cid-5',
        type: 'file',
        encoded_node: 'test-encoded-node-5',
        piece_index: null,
        piece_offset: null,
        block_published_on: null,
        tx_published_on: null,
      },
      {
        cid: 'test-cid-6',
        root_cid: rootCid,
        head_cid: 'test-head-cid-6',
        type: 'file',
        encoded_node: 'test-encoded-node-6',
        piece_index: null,
        piece_offset: null,
        block_published_on: null,
        tx_published_on: null,
      },
    ]

    await nodesRepository.saveNodes(nodes)

    const results = await nodesRepository.getNodesByRootCid(rootCid)

    expect(results.length).toBe(2)
    expect(results.map((r) => r.cid)).toContain(nodes[0].cid)
    expect(results.map((r) => r.cid)).toContain(nodes[1].cid)
  })

  it('should get node count', async () => {
    const rootCid = 'test-root-cid-count'
    const nodes: Node[] = [
      {
        cid: 'test-cid-count-1',
        root_cid: rootCid,
        head_cid: 'test-head-cid-count',
        type: 'file',
        encoded_node: 'test-encoded-node-count-1',
        piece_index: null,
        piece_offset: null,
        block_published_on: null,
        tx_published_on: null,
      },
      {
        cid: 'test-cid-count-2',
        root_cid: rootCid,
        head_cid: 'test-head-cid-count',
        type: 'directory',
        encoded_node: 'test-encoded-node-count-2',
        piece_index: null,
        piece_offset: null,
        block_published_on: null,
        tx_published_on: null,
      },
    ]

    await nodesRepository.saveNodes(nodes)

    const count = await nodesRepository.getNodeCount({ rootCid })

    expect(count.totalCount).toBe(2)
    expect(count.publishedCount).toBe(0)
    expect(count.archivedCount).toBe(0)
  })

  it('should get node count filtered by cid', async () => {
    const rootCid = 'test-root-cid-filter-cid'
    const nodes: Node[] = [
      {
        cid: 'test-cid-filter-1',
        root_cid: rootCid,
        head_cid: 'test-head-cid-filter',
        type: 'file',
        encoded_node: 'test-encoded-node-filter-1',
        piece_index: null,
        piece_offset: null,
        block_published_on: null,
        tx_published_on: null,
      },
      {
        cid: 'test-cid-filter-2',
        root_cid: rootCid,
        head_cid: 'test-head-cid-filter',
        type: 'directory',
        encoded_node: 'test-encoded-node-filter-2',
        piece_index: null,
        piece_offset: null,
        block_published_on: null,
        tx_published_on: null,
      },
    ]

    await nodesRepository.saveNodes(nodes)

    const count = await nodesRepository.getNodeCount({
      cid: 'test-cid-filter-1',
    })

    expect(count.totalCount).toBe(1)
    expect(count.publishedCount).toBe(0)
    expect(count.archivedCount).toBe(0)
  })

  it('should get node count filtered by head_cid', async () => {
    const rootCid = 'test-root-cid-filter-head'
    const nodes: Node[] = [
      {
        cid: 'test-cid-head-filter-1',
        root_cid: rootCid,
        head_cid: 'test-head-cid-filter-1',
        type: 'file',
        encoded_node: 'test-encoded-node-head-1',
        piece_index: null,
        piece_offset: null,
        block_published_on: null,
        tx_published_on: null,
      },
      {
        cid: 'test-cid-head-filter-2',
        root_cid: rootCid,
        head_cid: 'test-head-cid-filter-2',
        type: 'directory',
        encoded_node: 'test-encoded-node-head-2',
        piece_index: null,
        piece_offset: null,
        block_published_on: null,
        tx_published_on: null,
      },
    ]

    await nodesRepository.saveNodes(nodes)

    const count = await nodesRepository.getNodeCount({
      headCid: 'test-head-cid-filter-1',
    })

    expect(count.totalCount).toBe(1)
    expect(count.publishedCount).toBe(0)
    expect(count.archivedCount).toBe(0)
  })

  it('should get node count filtered by type', async () => {
    const rootCid = 'test-root-cid-filter-type'
    const nodes: Node[] = [
      {
        cid: 'test-cid-type-filter-1',
        root_cid: rootCid,
        head_cid: 'test-head-cid-type',
        type: MetadataType.File,
        encoded_node: 'test-encoded-node-type-1',
        piece_index: null,
        piece_offset: null,
        block_published_on: null,
        tx_published_on: null,
      },
      {
        cid: 'test-cid-type-filter-2',
        root_cid: rootCid,
        head_cid: 'test-head-cid-type',
        type: MetadataType.Folder,
        encoded_node: 'test-encoded-node-type-2',
        piece_index: null,
        piece_offset: null,
        block_published_on: null,
        tx_published_on: null,
      },
      {
        cid: 'test-cid-type-filter-3',
        root_cid: rootCid,
        head_cid: 'test-head-cid-type',
        type: MetadataType.File,
        encoded_node: 'test-encoded-node-type-3',
        piece_index: null,
        piece_offset: null,
        block_published_on: null,
        tx_published_on: null,
      },
    ]

    await nodesRepository.saveNodes(nodes)

    const count = await nodesRepository.getNodeCount({
      type: MetadataType.File,
    })

    expect(count.totalCount).toBe(2)
    expect(count.publishedCount).toBe(0)
    expect(count.archivedCount).toBe(0)
  })

  it('should get archiving nodes CID', async () => {
    const node: Node = {
      cid: 'test-cid-archiving',
      root_cid: 'test-root-cid-archiving',
      head_cid: 'test-head-cid-archiving',
      type: 'file',
      encoded_node: 'test-encoded-node-archiving',
      piece_index: null,
      piece_offset: null,
      block_published_on: null,
      tx_published_on: null,
    }

    await nodesRepository.saveNode(node)

    const archivingCids = await nodesRepository.getArchivingNodesCID()

    expect(archivingCids).toContain(node.cid)
  })

  it('should set node archiving data', async () => {
    const node: Node = {
      cid: 'test-cid-set-archiving',
      root_cid: 'test-root-cid-set-archiving',
      head_cid: 'test-head-cid-set-archiving',
      type: 'file',
      encoded_node: 'test-encoded-node-set-archiving',
      piece_index: null,
      piece_offset: null,
      block_published_on: null,
      tx_published_on: null,
    }

    await nodesRepository.saveNode(node)
    await nodesRepository.setNodeArchivingData({
      cid: node.cid,
      pieceIndex: 1,
      pieceOffset: 100,
    })

    const result = await nodesRepository.getNode(node.cid)

    expect(result?.piece_index).toBe(1)
    expect(result?.piece_offset).toBe(100)
  })

  it('should remove nodes by root CID', async () => {
    const rootCid = 'test-root-cid-remove'
    const nodes: Node[] = [
      {
        cid: 'test-cid-remove-1',
        root_cid: rootCid,
        head_cid: 'test-head-cid-remove',
        type: 'file',
        encoded_node: 'test-encoded-node-remove-1',
        piece_index: null,
        piece_offset: null,
        block_published_on: null,
        tx_published_on: null,
      },
      {
        cid: 'test-cid-remove-2',
        root_cid: rootCid,
        head_cid: 'test-head-cid-remove',
        type: 'file',
        encoded_node: 'test-encoded-node-remove-2',
        piece_index: null,
        piece_offset: null,
        block_published_on: null,
        tx_published_on: null,
      },
    ]

    await nodesRepository.saveNodes(nodes)
    await nodesRepository.removeNodeDataByRootCid(rootCid)
    const results = await nodesRepository.getNodesByRootCid(rootCid)
    const fullNodes = await Promise.all(
      results.map((r) => nodesRepository.getNode(r.cid)),
    )
    fullNodes.forEach((n) => {
      expect(n?.encoded_node).toBeNull()
    })
  })

  it('should get nodes by CIDs', async () => {
    const nodes: Node[] = [
      {
        cid: 'test-cid-get-by-cids-1',
        root_cid: 'test-root-cid-get-by-cids',
        head_cid: 'test-head-cid-get-by-cids',
        type: 'file',
        encoded_node: 'test-encoded-node-get-by-cids-1',
        piece_index: null,
        piece_offset: null,
        block_published_on: null,
        tx_published_on: null,
      },
      {
        cid: 'test-cid-get-by-cids-2',
        root_cid: 'test-root-cid-get-by-cids',
        head_cid: 'test-head-cid-get-by-cids',
        type: 'file',
        encoded_node: 'test-encoded-node-get-by-cids-2',
        piece_index: null,
        piece_offset: null,
        block_published_on: null,
        tx_published_on: null,
      },
    ]

    await nodesRepository.saveNodes(nodes)

    const results = await nodesRepository.getNodesByCids([
      nodes[0].cid,
      nodes[1].cid,
    ])

    expect(results.length).toBe(2)
    expect(results.map((r) => r.cid)).toContain(nodes[0].cid)
    expect(results.map((r) => r.cid)).toContain(nodes[1].cid)
  })

  it('should update node published on', async () => {
    const node: Node = {
      cid: 'test-cid-published',
      root_cid: 'test-root-cid-published',
      head_cid: 'test-head-cid-published',
      type: 'file',
      encoded_node: 'test-encoded-node-published',
      piece_index: null,
      piece_offset: null,
      block_published_on: null,
      tx_published_on: null,
    }

    await nodesRepository.saveNode(node)
    await nodesRepository.updateNodePublishedOn(node.cid, 12345, 'tx-hash')

    const result = await nodesRepository.getNode(node.cid)

    expect(result?.block_published_on).toBe(12345)
    expect(result?.tx_published_on).toBe('tx-hash')
  })

  it('should get uploaded nodes by root CID', async () => {
    const rootCid = 'test-root-cid-uploaded'
    const nodes: Node[] = [
      {
        cid: 'test-cid-uploaded-1',
        root_cid: rootCid,
        head_cid: 'test-head-cid-uploaded',
        type: 'file',
        encoded_node: 'test-encoded-node-uploaded-1',
        piece_index: null,
        piece_offset: null,
        block_published_on: 12345,
        tx_published_on: 'tx-hash-1',
      },
      {
        cid: 'test-cid-uploaded-2',
        root_cid: rootCid,
        head_cid: 'test-head-cid-uploaded',
        type: 'file',
        encoded_node: 'test-encoded-node-uploaded-2',
        piece_index: null,
        piece_offset: null,
        block_published_on: null,
        tx_published_on: null,
      },
    ]

    await nodesRepository.saveNodes(nodes)

    const results = await nodesRepository.getUploadedNodesByRootCid(rootCid)

    expect(results.length).toBe(1)
    expect(results[0].cid).toBe(nodes[0].cid)
  })

  it('should get last archived piece node', async () => {
    const nodes: Node[] = [
      {
        cid: 'test-cid-last-archived-1',
        root_cid: 'test-root-cid-last-archived',
        head_cid: 'test-head-cid-last-archived',
        type: 'file',
        encoded_node: 'test-encoded-node-last-archived-1',
        piece_index: 1,
        piece_offset: 100,
        block_published_on: null,
        tx_published_on: null,
      },
      {
        cid: 'test-cid-last-archived-2',
        root_cid: 'test-root-cid-last-archived',
        head_cid: 'test-head-cid-last-archived',
        type: 'file',
        encoded_node: 'test-encoded-node-last-archived-2',
        piece_index: 2,
        piece_offset: 200,
        block_published_on: null,
        tx_published_on: null,
      },
    ]

    await nodesRepository.saveNodes(nodes)

    const result = await nodesRepository.getLastArchivedPieceNode()

    expect(result).toBeDefined()
    expect(result?.piece_index).toBe(2)
    expect(result?.piece_offset).toBe(200)
  })
})
