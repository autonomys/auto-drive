import { IPLDNodeData } from '@autonomys/auto-dag-data'

export interface NodeWithMetadata {
  cid: string
  metadata: IPLDNodeData
  links: string[]
}
