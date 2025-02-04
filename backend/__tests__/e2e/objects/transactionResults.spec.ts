import { v4 } from 'uuid'
import { TransactionResult } from '../../../src/models/objects'
import { TransactionResultsUseCases } from '../../../src/useCases'
import { dbMigration } from '../../utils/dbMigrate'
import { mockRabbitPublish, unmockMethods } from '../../utils/mocks'

describe('Transaction Results', () => {
  beforeAll(async () => {
    mockRabbitPublish()
    await dbMigration.up()
  })

  afterAll(async () => {
    await dbMigration.down()
    unmockMethods()
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
