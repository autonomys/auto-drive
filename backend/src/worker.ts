import { nodeMigrator } from './services/nodeMigrator/index.js'
import { objectMappingArchiver } from './services/objectMappingArchiver/index.js'
import { onchainPublisher } from './services/onchainPublisher/index.js'

nodeMigrator.start()
onchainPublisher.start()
objectMappingArchiver.start()
