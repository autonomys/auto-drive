import { TransactionResultsUseCases } from '../../useCases/index.js'
import { safeCallback } from '../../utils/safe.js'
import { createTransactionManager } from './transactionManager.js'
import { compactAddLength } from '@polkadot/util'

const state = {
  executing: false,
  time: 10_000,
}

const transactionManager = createTransactionManager()

const processPendingUploads = safeCallback(async () => {
  try {
    if (state.executing) {
      return
    }
    state.executing = true

    const pendingUploads =
      await TransactionResultsUseCases.getPendingTransactionResults(20)

    console.log(`${pendingUploads.length} pending uploads`)
    if (pendingUploads.length === 0) {
      return
    }

    const transactions = pendingUploads.map((upload) => {
      const buffer = Buffer.from(upload.encoded_node, 'base64')

      return {
        module: 'system',
        method: 'remark',
        params: [compactAddLength(buffer)],
      }
    })

    const results = await transactionManager.submit(transactions)

    await Promise.all(
      pendingUploads.map((upload, index) =>
        TransactionResultsUseCases.setTransactionResults(
          upload.cid,
          results[index],
        ),
      ),
    )
  } catch (error) {
    console.error(error)
  } finally {
    state.executing = false
  }
})

export const onchainPublisher = {
  start: (time: number = 10_000) => {
    state.time = time
    setInterval(processPendingUploads, state.time)
  },
}
