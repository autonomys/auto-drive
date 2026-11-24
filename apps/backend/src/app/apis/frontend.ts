import 'dotenv/config.js'
import { createFrontendApp } from './frontendApp.js'
import { config } from '../../config.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import { usdcChainGuard } from '../../infrastructure/services/paymentManager/usdcChainGuard.js'

const logger = createLogger('api:frontend')

const createServer = async () => {
  logger.debug('Initializing frontend API server')
  const app = createFrontendApp()

  // Verify ETH_CHAIN_ID against the endpoint, in the process that SERVES it.
  //
  // `start:fe:api` runs no payment manager — deliberately, since that would put
  // a second credit poller behind every replica — yet this is the process a
  // buyer asks for `GET /payments/usdc/target` and the one that quotes their
  // intent. A verdict reached only in the worker would leave every API replica
  // happily selling a chain nothing watches. Fire-and-forget: it fails closed on
  // a verified mismatch and changes nothing otherwise, so it must not delay
  // listen().
  void usdcChainGuard.verify()

  app.listen(config.express.port, () => {
    logger.info('Server running at http://localhost:%d', config.express.port)
  })
}

createServer().catch(console.error)
