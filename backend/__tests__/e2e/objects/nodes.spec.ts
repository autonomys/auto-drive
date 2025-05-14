import { v4 } from 'uuid'
import { NodesUseCases, ObjectUseCases } from '../../../src/useCases/index.js'
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
} from '../../../src/repositories/index.js'
import { ObjectMappingListEntry } from '@auto-drive/models'
import { mockRabbitPublish, unmockMethods } from '../../utils/mocks.js'
import { downloadService } from '../../../src/services/download/index.js'
import { jest } from '@jest/globals'
import { Readable } from 'stream'

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
      .spyOn(ObjectUseCases, 'processArchival')
      .mockResolvedValue()
    const downloadServiceSpy = jest
      .spyOn(downloadService, 'download')
      .mockResolvedValue(Readable.from(Buffer.from(encodeNode(node))))
    const hash = Buffer.from(blake3HashFromCid(cid)).toString('hex')
    await NodesUseCases.processNodeArchived([[hash, 1, 1]])

    expect(processArchivalSpy).toHaveBeenCalledWith(cidToString(cid))
    expect(downloadServiceSpy).toHaveBeenCalledWith(cidToString(cid))
    expect(processArchivalSpy).toHaveBeenCalledTimes(1)
    expect(downloadServiceSpy).toHaveBeenCalledTimes(1)
  })
})
