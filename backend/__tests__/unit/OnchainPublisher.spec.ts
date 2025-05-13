import { Node, nodesRepository } from '../../src/repositories/index.js'
import { compactAddLength } from '@polkadot/util'
import {
  OnchainPublisher,
  transactionManager,
} from '../../src/services/upload/onchainPublisher/index.js'
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

    jest.spyOn(nodesRepository, 'getNodeCount').mockResolvedValue({
      totalCount: 0,
      archivedCount: 0,
    })

    await OnchainPublisher.publishNodes(
      nodes.map((e) => e.cid),
      3,
    )

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

    jest.spyOn(nodesRepository, 'getNodeCount').mockImplementation((cid) => {
      if (publishedNodes.includes(cid.cid!)) {
        return Promise.resolve({
          totalCount: 1,
          archivedCount: 0,
        })
      }

      return Promise.resolve({
        totalCount: 0,
        archivedCount: 0,
      })
    })
    await OnchainPublisher.publishNodes(
      nodes.map((e) => e.cid),
      3,
    )

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
