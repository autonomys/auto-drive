import { v4 } from 'uuid'
import { NodesUseCases, ObjectUseCases } from '../../../src/core/index.js'
import {
  blake3HashFromCid,
  cidOfNode,
  cidToString,
  createFileChunkIpldNode,
  createNode,
  createSingleFileIpldNode,
  encodeNode,
  MetadataType,
  OffchainMetadata,
} from '@autonomys/auto-dag-data'
import { dbMigration } from '../../utils/dbMigrate.js'
import {
  metadataRepository,
  Node,
  nodesRepository,
} from '../../../src/infrastructure/repositories/index.js'
import {
  ObjectMapping,
  ObjectMappingListEntry,
  TransactionResult,
} from '@auto-drive/models'
import { mockRabbitPublish, unmockMethods } from '../../utils/mocks.js'
import { jest } from '@jest/globals'
import { EventRouter } from '../../../src/infrastructure/eventRouter/index.js'
import { BlockstoreUseCases } from '../../../src/core/uploads/blockstore.js'
import { MAX_RETRIES } from '../../../src/infrastructure/eventRouter/tasks.js'

describe('Nodes', () => {
  const id = v4()

  const expectNode = {
    cid: id,
    headCid: id,
    rootCid: id,
    type: MetadataType.File,
    encodedNode: '',
  }

  beforeAll(async () => {
    mockRabbitPublish()
    await dbMigration.up()
  })
  afterAll(async () => {
    await dbMigration.down()
    unmockMethods()
    jest.clearAllMocks()
  })

  it('should be able to save node', async () => {
    await expect(
      NodesUseCases.saveNode(
        expectNode.cid,
        expectNode.headCid,
        expectNode.rootCid,
        expectNode.type,
        expectNode.encodedNode,
      ),
    ).resolves.not.toThrow()
  })

  it('should be able to get node', async () => {
    const node = await nodesRepository.getNode(id)
    expect(node).toMatchObject({
      cid: expectNode.cid,
      head_cid: expectNode.headCid,
      root_cid: expectNode.rootCid,
      type: expectNode.type,
      encoded_node: expectNode.encodedNode,
    })
  })

  it('should be able to get chunk data', async () => {
    const buffer = Buffer.from('test')
    const cid = v4()
    await NodesUseCases.saveNode(
      cid,
      cid,
      cid,
      MetadataType.File,
      Buffer.from(encodeNode(createFileChunkIpldNode(buffer))).toString(
        'base64',
      ),
    )
    const data = await NodesUseCases.getChunkData(cid)
    expect(data).toEqual(buffer)
  })

  it('should be able to get node with wrong cid returns undefined', async () => {
    const data = await NodesUseCases.getNode(v4())
    expect(data).toBeUndefined()
  })

  it('should be able to get blockstore', async () => {
    const node = createNode(Buffer.from('test'), [])
    const randomCID = cidOfNode(node)
    await NodesUseCases.saveNode(
      randomCID,
      randomCID,
      randomCID,
      MetadataType.File,
      Buffer.from(
        encodeNode(createFileChunkIpldNode(Buffer.from(encodeNode(node)))),
      ).toString('base64'),
    )

    const blockstore = await nodesRepository.getNode(cidToString(randomCID))

    expect(blockstore).toMatchObject({
      cid: cidToString(randomCID),
      head_cid: cidToString(randomCID),
      root_cid: cidToString(randomCID),
      type: MetadataType.File,
      encoded_node: expect.any(String),
    })
  })

  it('should be able to save nodes', async () => {
    const nodes = Array.from({ length: 10 }, (_, index) =>
      createSingleFileIpldNode(Buffer.from(`test-${index}`), `test-${index}`),
    )
    await NodesUseCases.saveNodes(id, id, nodes)
  })

  it('process node archived', async () => {
    const node = createSingleFileIpldNode(Buffer.from('test'), 'test')
    const cid = cidOfNode(node)
    const hash = Buffer.from(blake3HashFromCid(cid)).toString('hex')
    const objectMappings: ObjectMappingListEntry = {
      blockNumber: 1,
      v0: {
        objects: [[hash, 1, 1]],
      },
    }

    await NodesUseCases.saveNodes(cid, cid, [node])

    await NodesUseCases.processNodeArchived(objectMappings.v0.objects)

    const savedNode = await nodesRepository.getNode(cidToString(cid))
    expect(savedNode).toMatchObject({
      cid: cidToString(cid),
      piece_index: 1,
      piece_offset: 1,
    })
  })

  it('double processed node archival should not fail', async () => {
    const text = 'some_random_text'
    const node = createSingleFileIpldNode(Buffer.from(text), text)
    const cid = cidOfNode(node)
    const nodes: Node[] = [
      {
        cid: cidToString(cid),
        head_cid: cidToString(cid),
        root_cid: cidToString(cid),
        type: MetadataType.File,
        encoded_node: Buffer.from(encodeNode(node)).toString('base64'),
        block_published_on: 0,
        tx_published_on: '0x0',
        piece_index: null,
        piece_offset: null,
      },
      {
        cid: cidToString(cid),
        head_cid: cidToString(cid),
        root_cid: cidToString(cid),
        type: MetadataType.File,
        encoded_node: Buffer.from(encodeNode(node)).toString('base64'),
        block_published_on: 1,
        tx_published_on: '0x1',
        piece_index: null,
        piece_offset: null,
      },
    ]

    await Promise.all(nodes.map((node) => nodesRepository.saveNode(node)))

    await metadataRepository.setMetadata(
      cidToString(cid),
      cidToString(cid),
      // Mock the metadata
      {} as unknown as OffchainMetadata,
    )

    const processArchivalSpy = jest
      .spyOn(EventRouter, 'publish')
      .mockReturnValue()
    const hash = Buffer.from(blake3HashFromCid(cid)).toString('hex')
    await NodesUseCases.processNodeArchived([[hash, 1, 1]])

    expect(processArchivalSpy).toHaveBeenCalledWith({
      id: 'object-archived',
      params: {
        cid: cidToString(cid),
      },
      retriesLeft: MAX_RETRIES,
    })
    expect(processArchivalSpy).toHaveBeenCalledTimes(1)

    // Mock the callback execution of the event above
    await ObjectUseCases.onObjectArchived(cidToString(cid))

    const metadata = await metadataRepository.getMetadata(cidToString(cid))
    expect(metadata).toBeDefined()
    expect(metadata?.is_archived).toBe(true)
  })

  it('should get chunk data from node repository', async () => {
    const text = 'chunk_data_test'
    const node = createSingleFileIpldNode(Buffer.from(text), text)
    const cid = cidOfNode(node)
    const cidString = cidToString(cid)
    const encodedNode = Buffer.from(encodeNode(node)).toString('base64')

    await nodesRepository.saveNode({
      cid: cidString,
      head_cid: cidString,
      root_cid: cidString,
      type: MetadataType.File,
      encoded_node: encodedNode,
      block_published_on: null,
      tx_published_on: null,
      piece_index: null,
      piece_offset: null,
    })

    const chunkData = await NodesUseCases.getChunkData(cid)
    expect(chunkData).toBeDefined()
    expect(chunkData?.toString()).toBe(text)
  })

  it('should get chunk data from blockstore if not in node repository', async () => {
    const text = 'blockstore_chunk_data'
    const node = createSingleFileIpldNode(Buffer.from(text), text)
    const cid = cidOfNode(node)
    const cidString = cidToString(cid)

    // Mock BlockstoreUseCases.getNode to return the node
    const getNodeSpy = jest
      .spyOn(BlockstoreUseCases, 'getNode')
      .mockResolvedValue(Buffer.from(encodeNode(node)))

    const chunkData = await NodesUseCases.getChunkData(cidString)
    expect(getNodeSpy).toHaveBeenCalledWith(cidString)
    expect(chunkData).toBeDefined()
    expect(chunkData?.toString()).toBe(text)

    getNodeSpy.mockRestore()
  })

  it('should return undefined when chunk data is not found', async () => {
    const nonExistentCid =
      'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'

    // Mock BlockstoreUseCases.getNode to return undefined
    const getNodeSpy = jest
      .spyOn(BlockstoreUseCases, 'getNode')
      .mockResolvedValue(undefined)

    const chunkData = await NodesUseCases.getChunkData(nonExistentCid)
    expect(chunkData).toBeUndefined()

    getNodeSpy.mockRestore()
  })

  it('should save multiple nodes', async () => {
    const text1 = 'save_nodes_test_1'
    const text2 = 'save_nodes_test_2'
    const node1 = createSingleFileIpldNode(Buffer.from(text1), text1)
    const node2 = createSingleFileIpldNode(Buffer.from(text2), text2)
    const rootCid = cidOfNode(node1)
    const headCid = cidOfNode(node2)

    await NodesUseCases.saveNodes(rootCid, headCid, [node1, node2])

    const savedNode1 = await nodesRepository.getNode(
      cidToString(cidOfNode(node1)),
    )
    const savedNode2 = await nodesRepository.getNode(
      cidToString(cidOfNode(node2)),
    )

    expect(savedNode1).toBeDefined()
    expect(savedNode2).toBeDefined()
    expect(savedNode1?.root_cid).toBe(cidToString(rootCid))
    expect(savedNode2?.root_cid).toBe(cidToString(rootCid))
    expect(savedNode1?.head_cid).toBe(cidToString(headCid))
    expect(savedNode2?.head_cid).toBe(cidToString(headCid))
  })

  it('should get CIDs by root CID', async () => {
    const text = 'get_cids_by_root_test'
    const node = createSingleFileIpldNode(Buffer.from(text), text)
    const cid = cidOfNode(node)
    const cidString = cidToString(cid)

    await nodesRepository.saveNode({
      cid: cidString,
      head_cid: cidString,
      root_cid: cidString,
      type: MetadataType.File,
      encoded_node: Buffer.from(encodeNode(node)).toString('base64'),
      block_published_on: null,
      tx_published_on: null,
      piece_index: null,
      piece_offset: null,
    })

    const cids = await NodesUseCases.getCidsByRootCid(cidString)
    expect(cids).toContain(cidString)
  })

  it('should get nodes by CIDs', async () => {
    const text = 'get_nodes_by_cids_test'
    const node = createSingleFileIpldNode(Buffer.from(text), text)
    const cid = cidOfNode(node)
    const cidString = cidToString(cid)

    await nodesRepository.saveNode({
      cid: cidString,
      head_cid: cidString,
      root_cid: cidString,
      type: MetadataType.File,
      encoded_node: Buffer.from(encodeNode(node)).toString('base64'),
      block_published_on: null,
      tx_published_on: null,
      piece_index: null,
      piece_offset: null,
    })

    const nodes = await NodesUseCases.getNodesByCids([cidString])
    expect(nodes).toHaveLength(1)
    expect(nodes[0].cid).toBe(cidString)
  })

  it('should schedule node archiving', async () => {
    const publishSpy = jest
      .spyOn(EventRouter, 'publish')
      .mockImplementation(() => {})

    const objects: ObjectMapping[] = [['deadbeef', 1, 2]]
    await NodesUseCases.scheduleNodeArchiving(objects)

    expect(publishSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'archive-objects',
        params: {
          objects,
        },
      }),
    ])

    publishSpy.mockRestore()
  })

  it('should set published on information', async () => {
    const text = 'set_published_on_test'
    const node = createSingleFileIpldNode(Buffer.from(text), text)
    const cid = cidOfNode(node)
    const cidString = cidToString(cid)

    await nodesRepository.saveNode({
      cid: cidString,
      head_cid: cidString,
      root_cid: cidString,
      type: MetadataType.File,
      encoded_node: Buffer.from(encodeNode(node)).toString('base64'),
      block_published_on: null,
      tx_published_on: null,
      piece_index: null,
      piece_offset: null,
    })

    const result: TransactionResult = {
      blockNumber: 12345,
      txHash: '0xabcdef',
      status: 'success',
      success: true,
    }

    await NodesUseCases.setPublishedOn(cidString, result)

    const updatedNode = await nodesRepository.getNode(cidString)
    expect(updatedNode?.block_published_on).toBe(12345)
    expect(updatedNode?.tx_published_on).toBe('0xabcdef')
  })

  it('should throw error when setting published on with missing data', async () => {
    const cidString =
      'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
    // @ts-expect-error: This is a test
    const incompleteResult: TransactionResult = {}

    await expect(
      NodesUseCases.setPublishedOn(cidString, incompleteResult),
    ).rejects.toThrow(`No block number or tx hash for ${cidString}`)
  })
})
