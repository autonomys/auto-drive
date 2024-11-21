import { v4 } from 'uuid'
import { TransactionResult } from '../../../src/models/objects'
import {
  NodesUseCases,
  TransactionResultsUseCases,
} from '../../../src/useCases'
import { cidOfNode, createSingleFileIpldNode } from '@autonomys/auto-dag-data'
import { dbMigration } from '../../utils/dbMigrate'

describe('Transaction Results', () => {
  beforeAll(async () => {
    await dbMigration.up()
  })

  afterAll(async () => {
    await dbMigration.down()
  })

  it('should be able to save transaction results', async () => {
    const transactionResult: TransactionResult = {
      success: true,
      batchTxHash: '0x123',
      status: 'success',
    }

    const cid = v4()

    await TransactionResultsUseCases.setTransactionResults(
      cid,
      transactionResult,
    )

    const savedTransactionResult =
      await TransactionResultsUseCases.getNodeTransactionResult(cid)

    expect(savedTransactionResult).toEqual(transactionResult)
  })
})
