import {
  cidFromBlakeHash,
  cidOfNode,
  cidToString,
  decodeIPLDNodeData,
  encodeNode,
  IPLDNodeData,
  MetadataType,
} from '@autonomys/auto-dag-data'
import { PBNode } from '@ipld/dag-pb'
import { CID } from 'multiformats'
import { nodesRepository } from '../../infrastructure/repositories/index.js'
import { uploadsRepository } from '../../infrastructure/repositories/uploads/uploads.js'
import { getUploadBlockstore } from '../../infrastructure/services/upload/uploadProcessorCache/index.js'
import {
  asyncIterableForEach,
  asyncIterableToPromiseOfArray,
} from '@autonomys/asynchronous'
import { BlockstoreUseCases } from '../uploads/blockstore.js'
import {
  UploadType,
  ObjectMapping,
  TransactionResult,
} from '@auto-drive/models'
import { ObjectUseCases } from './object.js'
import { createLogger } from '../../infrastructure/drivers/logger.js'
import { Node } from '../../infrastructure/repositories/objects/nodes.js'
import { EventRouter } from '../../infrastructure/eventRouter/index.js'
import { createTask, Task } from '../../infrastructure/eventRouter/tasks.js'
import { OnchainPublisher } from '../../infrastructure/services/upload/onchainPublisher/index.js'

const logger = createLogger('useCases:objects:nodes')

const getNode = async (cid: string | CID): Promise<string | undefined> => {
  const cidString = typeof cid === 'string' ? cid : cidToString(cid)
  logger.debug('Fetching node (cid=%s)', cidString)
  const node = await nodesRepository.getNode(cidString)
  if (!node) {
    logger.warn('Node not found (cid=%s)', cidString)
    return undefined
  }

  return node.encoded_node
}

const saveNode = async (
  rootCid: string | CID,
  headCid: string | CID,
  cid: string | CID,
  type: MetadataType,
  encodedNode: string,
) => {
  const headCidString =
    typeof headCid === 'string' ? headCid : cidToString(headCid)
  const rootCidString =
    typeof rootCid === 'string' ? rootCid : cidToString(rootCid)
  const cidString = typeof cid === 'string' ? cid : cidToString(cid)

  await nodesRepository.saveNode({
    root_cid: rootCidString,
    head_cid: headCidString,
    cid: cidString,
    type,
    encoded_node: encodedNode,
    block_published_on: null,
    tx_published_on: null,
    piece_index: null,
    piece_offset: null,
  })
}

const getChunkData = async (cid: string | CID): Promise<Buffer | undefined> => {
  const cidString = typeof cid === 'string' ? cid : cidToString(cid)

  let ipldNodeBytes: Buffer | undefined = await nodesRepository
    .getNode(cidString)
    .then((e) => {
      if (!e || !e.encoded_node) {
        return undefined
      }

      return Buffer.from(e.encoded_node, 'base64')
    })

  if (!ipldNodeBytes) {
    ipldNodeBytes = await BlockstoreUseCases.getNode(cidString)
  }

  if (!ipldNodeBytes) {
    return undefined
  }

  const chunkData = decodeIPLDNodeData(new Uint8Array(ipldNodeBytes))

  if (!chunkData) {
    return undefined
  }

  return chunkData.data ? Buffer.from(chunkData.data) : undefined
}

const saveNodes = async (
  rootCid: string | CID,
  headCid: string | CID,
  nodes: PBNode[],
) => {
  return Promise.all(
    nodes.map((node) => {
      const cid = cidToString(cidOfNode(node))
      const { type } = IPLDNodeData.decode(node.Data!)
      return saveNode(
        rootCid,
        headCid,
        cid,
        type,
        Buffer.from(encodeNode(node)).toString('base64'),
      )
    }),
  )
}

const getUploadCID = async (uploadId: string): Promise<CID> => {
  logger.debug('Getting CID for upload (uploadId=%s)', uploadId)
  const upload = await uploadsRepository.getUploadEntryById(uploadId)
  if (!upload) {
    logger.error('Upload object not found (uploadId=%s)', uploadId)
    throw new Error(`Upload object not found ${uploadId}`)
  }

  const cid =
    upload.type === UploadType.FILE
      ? await BlockstoreUseCases.getFileUploadIdCID(uploadId)
      : await BlockstoreUseCases.getFolderUploadIdCID(uploadId)

  logger.trace(
    'Retrieved CID for upload (uploadId=%s, cid=%s)',
    uploadId,
    cidToString(cid),
  )
  return cid
}

const migrateFromBlockstoreToNodesTable = async (
  uploadId: string,
): Promise<void> => {
  const uploads = await uploadsRepository.getUploadsByRoot(uploadId)
  const rootCID = await getUploadCID(uploadId)

  const metadata = await ObjectUseCases.getMetadata(cidToString(rootCID))
  if (!metadata) {
    return
  }

  for (const upload of uploads) {
    const headCID = await getUploadCID(upload.id)
    const blockstore = await getUploadBlockstore(upload.id)

    const BATCH_SIZE = 100
    await asyncIterableForEach(
      blockstore.getAllKeys(),
      async (batch) => {
        const nodes = await asyncIterableToPromiseOfArray(
          blockstore.getMany(batch),
        )
        const uniqueNodes = Array.from(
          new Map(nodes.map((node) => [cidToString(node.cid), node])).values(),
        )

        await nodesRepository.saveNodes(
          uniqueNodes.map((e) => ({
            cid: cidToString(e.cid),
            root_cid: cidToString(rootCID),
            head_cid: cidToString(headCID),
            type: decodeIPLDNodeData(Buffer.from(e.block)).type,
            encoded_node: Buffer.from(e.block).toString('base64'),
            block_published_on: null,
            tx_published_on: null,
            piece_index: null,
            piece_offset: null,
          })),
        )
      },
      BATCH_SIZE,
    )
  }
}

const processNodeArchived = async (objectMappings: ObjectMapping[]) => {
  const nodes = await nodesRepository.getArchivingNodesCID()

  const objects = objectMappings
    .filter((e) => {
      // Transform the object mapping hash to a cid
      const cid = cidToString(cidFromBlakeHash(Buffer.from(e[0], 'hex')))

      // Check if the cid is in the nodes array
      const isCidArchiving = nodes.includes(cid)

      return isCidArchiving
    })
    .map((e) => {
      const cid = cidToString(cidFromBlakeHash(Buffer.from(e[0], 'hex')))
      return {
        cid,
        pieceIndex: e[1],
        pieceOffset: e[2],
      }
    })

  await Promise.all(objects.map((e) => nodesRepository.setNodeArchivingData(e)))
  await ObjectUseCases.checkObjectsArchivalStatus()
}

const scheduleNodeArchiving = async (
  objects: ObjectMapping[],
): Promise<void> => {
  const tasks: Task[] = [
    createTask({
      id: 'archive-objects',
      params: {
        objects,
      },
    }),
  ]
  EventRouter.publish(tasks)
}

const getCidsByRootCid = async (rootCid: string): Promise<string[]> => {
  return nodesRepository
    .getNodesByRootCid(rootCid)
    .then((e) => e.map((e) => e.cid))
}

const getNodesByCids = async (cids: string[]): Promise<Node[]> => {
  return nodesRepository.getNodesByCids(cids)
}

const setPublishedOn = async (
  cid: string,
  result: TransactionResult,
): Promise<void> => {
  logger.debug('Setting published transaction details for node (cid=%s)', cid)
  if (!result.blockNumber || !result.txHash) {
    logger.error('No block number or tx hash for node (cid=%s)', cid)
    throw new Error(`No block number or tx hash for ${cid}`)
  }

  await nodesRepository.updateNodePublishedOn(
    cid,
    result.blockNumber,
    result.txHash,
  )
  logger.info(
    'Node published transaction details updated (cid=%s, txHash=%s, blockNumber=%d)',
    cid,
    result.txHash,
    result.blockNumber,
  )

  return
}

const ensureObjectPublished = async (cid: string): Promise<void> => {
  const nodes = await nodesRepository.getNodesByRootCid(cid)
  if (nodes.length === 0) {
    throw new Error(`Nodes not found for ${cid}`)
  }

  await OnchainPublisher.publishNodes(nodes.map((node) => node.cid))
}

const handleRepeatedNodes = async (nodes: Node[]): Promise<void> => {
  logger.info(
    'Handling repeated nodes (cids=%s)',
    nodes.map((node) => node.cid).join(', '),
  )

  const nodesWithBlockchainData = await Promise.all(
    nodes.map((node) => nodesRepository.getNodeBlockchainData(node.cid)),
  ).then((e) => e.filter((e) => e !== undefined).map((e) => e!))

  const nodeBlockchainDataMap = new Map(
    nodesWithBlockchainData.map((e) => [e.cid, e]),
  )

  const updatedNodes = nodes.map((node) => {
    const nodeBlockchainData = nodeBlockchainDataMap.get(node.cid)
    if (!nodeBlockchainData) return node

    return { ...node, ...nodeBlockchainData }
  })

  await Promise.all(
    updatedNodes.map((node) =>
      nodesRepository.updateNodeBlockchainData(node.root_cid, node.cid, node),
    ),
  )
}

export const NodesUseCases = {
  getNode,
  saveNode,
  getChunkData,
  saveNodes,
  migrateFromBlockstoreToNodesTable,
  processNodeArchived,
  getCidsByRootCid,
  getNodesByCids,
  scheduleNodeArchiving,
  setPublishedOn,
  ensureObjectPublished,
  handleRepeatedNodes,
}
