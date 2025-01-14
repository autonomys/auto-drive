import { nodeMigrator } from './services/upload/nodeMigrator/index.js'
import { objectMappingArchiver } from './services/dsn/objectMappingListener/index.js'
import { onchainPublisher } from './services/upload/onchainPublisher/index.js'
import { objectArchiver } from './services/upload/nodeRemover/index.js'

nodeMigrator.start()
onchainPublisher.start()
objectMappingArchiver.start()
objectArchiver.start()
