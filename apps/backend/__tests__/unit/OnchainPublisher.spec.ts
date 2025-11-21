import {
  Node,
  nodesRepository,
} from '../../src/infrastructure/repositories/objects/nodes.js'
import { compactAddLength } from '@polkadot/util'
import {
  OnchainPublisher,
  transactionManager,
} from '../../src/infrastructure/services/upload/onchainPublisher/index.js'
import { jest } from '@jest/globals'
import { dbMigration } from '../utils/dbMigrate.js'

const MOCK_PUBLISH_RESULT = {
  success: true,
  status: 'Success',
  txHash: '0x123',
  blockNumber: 1,
  blockHash: '0x123',
}

describe('OnchainPublisher', () => {
  beforeAll(async () => {
    await dbMigration.up()
  })

  afterAll(async () => {
    await dbMigration.down()
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should publish nodes', async () => {
    const nodes: Node[] = [1, 2, 3].map((e) => ({
      cid: `QmHash${e}`,
      encoded_node: `QmHash${e}`,
    })) as unknown as Node[]

    jest.spyOn(nodesRepository, 'getNodesByCids').mockResolvedValue(nodes)
    const submitSpy = jest
      .spyOn(transactionManager, 'submit')
      .mockResolvedValue(nodes.map(() => MOCK_PUBLISH_RESULT))

    jest
      .spyOn(nodesRepository, 'getNodesBlockchainDataBatch')
      .mockResolvedValue([])

    await OnchainPublisher.publishNodes(nodes.map((e) => e.cid))

    const transactions = nodes.map((node) => {
      const buffer = Buffer.from(node.encoded_node, 'base64')

      return {
        module: 'system',
        method: 'remark',
        params: [compactAddLength(buffer)],
      }
    })

    expect(submitSpy).toHaveBeenCalledWith(transactions)
  })

  it('should not publish nodes if they are already published', async () => {
    const nodes: Node[] = [1, 2, 3].map((e) => ({
      cid: `QmHash${e}`,
      encoded_node: `QmHash${e}`,
    })) as unknown as Node[]

    const publishedNodes = nodes.slice(0, 1).map((e) => e.cid)

    jest.spyOn(nodesRepository, 'getNodesByCids').mockResolvedValue(nodes)
    const submitSpy = jest
      .spyOn(transactionManager, 'submit')
      .mockResolvedValue(nodes.map(() => MOCK_PUBLISH_RESULT))

    jest
      .spyOn(nodesRepository, 'getNodesBlockchainDataBatch')
      .mockResolvedValue(
        publishedNodes.map((cid) => ({
          cid,
          block_published_on: 1,
          tx_published_on: '0x123',
          piece_index: 0,
          piece_offset: 0,
        })),
      )
    await OnchainPublisher.publishNodes(nodes.map((e) => e.cid))

    const transactions = nodes
      .filter((e) => !publishedNodes.includes(e.cid))
      .map((node) => {
        const buffer = Buffer.from(node.encoded_node, 'base64')

        return {
          module: 'system',
          method: 'remark',
          params: [compactAddLength(buffer)],
        }
      })

    expect(submitSpy).toHaveBeenCalledWith(transactions)
  })
})
