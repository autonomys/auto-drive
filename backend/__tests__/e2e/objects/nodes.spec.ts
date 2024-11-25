import { v4 } from 'uuid'
import { NodesUseCases } from '../../../src/useCases/index.js'
import {
  blake3HashFromCid,
  cidOfNode,
  cidToString,
  createFileChunkIpldNode,
  createNode,
  createSingleFileIpldNode,
  encodeNode,
  MetadataType,
} from '@autonomys/auto-dag-data'
import { dbMigration } from '../../utils/dbMigrate.js'
import { nodesRepository } from '../../../src/repositories/index.js'
import { ObjectMappingListEntry } from '../../../src/models/objects/objectMappings.js'

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
    await dbMigration.up()
  })
  afterAll(async () => {
    await dbMigration.down()
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
    await NodesUseCases.saveNode(
      id,
      id,
      id,
      MetadataType.File,
      Buffer.from(encodeNode(createFileChunkIpldNode(buffer))).toString(
        'base64',
      ),
    )
    const data = await NodesUseCases.getChunkData(id)
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

    await NodesUseCases.processNodeArchived(objectMappings)

    const savedNode = await nodesRepository.getNode(cidToString(cid))
    expect(savedNode).toMatchObject({
      cid: cidToString(cid),
      piece_index: 1,
      piece_offset: 1,
    })
  })
})
