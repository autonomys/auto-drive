import { config } from '../../../../config.js'
import { createAutoFilesApi } from '@autonomys/auto-files'

export const FileGateway = createAutoFilesApi(
  config.filesGateway.url,
  config.filesGateway.token,
)
