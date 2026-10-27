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
import { blockstoreRepository } from '../../infrastructure/repositories/uploads/blockstore.js'
import { BlockstoreUseCases } from '../uploads/blockstore.js'
import { UnrecoverableUploadError } from '../uploads/errors.js'
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

/**
 * Resolve the payload of many chunks at once, returning a CID -> data map that
 * simply omits whatever could not be resolved.
 *
 * Batched because the alternative is what caused issue #815 to be reachable so
 * often. composeNodesDataAsFileReadable fetches up to `concurrentChunks` (100)
 * chunks at a time; resolving them one CID at a time meant up to 200 statements
 * per batch against a pg.Pool with the default max of 10 connections. A given
 * chunk's second statement could therefore be queued for hundreds of
 * milliseconds behind its own first one — which is what let a reader straddle
 * the migration's commit and the blockstore cleanup. One statement per batch
 * removes both the straddle (see resolveEncodedNodes) and the queueing.
 */
const getChunksData = async (
  cids: (string | CID)[],
): Promise<Map<string, Buffer>> => {
  const cidStrings = cids.map((cid) =>
    typeof cid === 'string' ? cid : cidToString(cid),
  )

  const encodedNodes = await nodesRepository.resolveEncodedNodes(cidStrings)

  const chunks = new Map<string, Buffer>()
  for (const [cidString, encodedNode] of encodedNodes) {
    const decoded = decodeIPLDNodeData(
      new Uint8Array(Buffer.from(encodedNode, 'base64')),
    )
    // A node that carries no data is not a chunk we can serve. Left out of the
    // map rather than mapped to an empty buffer, so callers cannot mistake
    // "resolved to nothing" for "resolved".
    if (decoded?.data) {
      chunks.set(cidString, Buffer.from(decoded.data))
    }
  }

  return chunks
}

const getChunkData = async (cid: string | CID): Promise<Buffer | undefined> => {
  const cidString = typeof cid === 'string' ? cid : cidToString(cid)

  return (await getChunksData([cidString])).get(cidString)
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

const MIGRATION_BATCH_SIZE = 100

const migrateFromBlockstoreToNodesTable = async (
  uploadId: string,
): Promise<void> => {
  const uploads = await uploadsRepository.getUploadsByRoot(uploadId)
  const rootCID = await getUploadCID(uploadId)

  // getMetadata returns a neverthrow Result, and a Result object is always truthy,
  // so the `if (!metadata) return` this replaces could never fire — migration ran
  // regardless of whether the object had a metadata row.
  //
  // Proceeding is the worst of the options. handleFileUploadFinalization and
  // handleFolderUploadFinalization save the metadata strictly BEFORE the upload
  // flips to MIGRATING and the migrate task is enqueued, and migrate only ever
  // runs on a root upload, so a missing row means the completion never got that
  // far and no retry will change it. Migrating anyway writes the nodes, deletes the
  // upload artifacts, then hands tag-upload a cid it cannot resolve — tagUpload
  // returns its error before reaching scheduleNodesPublish, so the object ends up
  // with nodes in the database, nothing enqueued to publish them, and no upload row
  // left for the recovery sweep to find.
  //
  // Restoring the original intent would only trade that for a silent return, which
  // leaves the row MIGRATING for the sweep to re-drive every staleness window,
  // forever. Parking it as FAILED is what this branch already does with the other
  // permanently-broken shapes: the sweep stops selecting it, the task acks instead
  // of dead-lettering, and auto_drive_upload_migration_unrecoverable makes it
  // visible.
  const metadata = await ObjectUseCases.getMetadata(cidToString(rootCID))
  if (metadata.isErr()) {
    logger.error(
      'No metadata for the root of a migrating upload (uploadId=%s, rootCid=%s)',
      uploadId,
      cidToString(rootCID),
    )
    throw new UnrecoverableUploadError(
      `No metadata found for the root of upload ${uploadId} (rootCid=${cidToString(rootCID)})`,
      uploadId,
    )
  }

  // Clear any nodes already written for this root before re-inserting. migrate
  // is not idempotent on its own: nodes.cid has no unique constraint
  // (nodes_pkey was dropped in 20250924123851), so a re-driven migration — the
  // recovery sweep, a handler retry, or a redelivery after a worker restart —
  // would re-INSERT and silently duplicate rows (which then fan out into
  // duplicate publish work via getCidsByRootCid). Deleting by root_cid first
  // makes each run produce a clean set. The per-upload guard in processMigration
  // prevents a concurrent run from racing this delete+insert; deletion is scoped
  // to this root_cid, so nodes shared with other objects are untouched, and only
  // not-yet-published nodes are affected (a published object's upload row is
  // already gone, so it is never re-driven).
  await nodesRepository.removeNodeByRootCid(cidToString(rootCID))

  for (const upload of uploads) {
    const headCID = await getUploadCID(upload.id)
    const cids = await blockstoreRepository.getDistinctCids(upload.id)

    for (let i = 0; i < cids.length; i += MIGRATION_BATCH_SIZE) {
      const batch = cids.slice(i, i + MIGRATION_BATCH_SIZE)
      const entries = await blockstoreRepository.getFirstEntriesByCids(
        upload.id,
        batch,
      )
      if (entries.length !== batch.length) {
        throw new Error(
          `Blockstore of upload ${upload.id} changed during migration: expected ${batch.length} nodes in this batch, read ${entries.length}`,
        )
      }

      await nodesRepository.saveNodes(
        entries.map((entry) => ({
          cid: entry.cid,
          root_cid: cidToString(rootCID),
          head_cid: cidToString(headCID),
          type: decodeIPLDNodeData(entry.data).type,
          encoded_node: entry.data.toString('base64'),
          block_published_on: null,
          tx_published_on: null,
          piece_index: null,
          piece_offset: null,
        })),
      )
    }

    logger.info(
      'Migrated %d distinct nodes to the nodes table (uploadId=%s, headCid=%s)',
      cids.length,
      upload.id,
      cidToString(headCID),
    )
  }
}

const processNodeArchived = async (objectMappings: ObjectMapping[]) => {
  const nodes = await nodesRepository.getArchivingNodesCID()
  const archivingCids = new Set(nodes)

  const objects = objectMappings
    .map((e) => ({
      cid: cidToString(cidFromBlakeHash(Buffer.from(e[0], 'hex'))),
      pieceIndex: e[1],
      pieceOffset: e[2],
    }))
    .filter((e) => archivingCids.has(e.cid))

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

const ensureObjectPublished = async (
  cid: string,
  signal?: AbortSignal,
): Promise<void> => {
  const nodes = await nodesRepository.getNodesByRootCid(cid)
  if (nodes.length === 0) {
    throw new Error(`Nodes not found for ${cid}`)
  }

  await OnchainPublisher.publishNodes(
    nodes.map((node) => node.cid),
    signal,
  )
}

const handleRepeatedNodes = async (nodes: Node[]): Promise<void> => {
  if (nodes.length === 0) return

  logger.info(
    'Handling repeated nodes (cids=%s)',
    nodes.map((node) => node.cid).join(', '),
  )

  // Optimize: Batch fetch blockchain data for all unique CIDs
  const uniqueCids = Array.from(new Set(nodes.map((node) => node.cid)))
  const nodesWithBlockchainData =
    await nodesRepository.getNodesBlockchainDataBatch(uniqueCids)

  const nodeBlockchainDataMap = new Map(
    nodesWithBlockchainData.map((e) => [e.cid, e]),
  )

  // Prepare batch updates - only update nodes that have blockchain data
  const updates = nodes
    .map((node) => {
      const nodeBlockchainData = nodeBlockchainDataMap.get(node.cid)
      if (!nodeBlockchainData) return null

      return {
        rootCid: node.root_cid,
        cid: node.cid,
        blockchainData: nodeBlockchainData,
      }
    })
    .filter((u): u is NonNullable<typeof u> => u !== null)

  // Optimize with batch update
  if (updates.length > 0) {
    await nodesRepository.updateNodesBlockchainDataBatch(updates)
  }
}

export const NodesUseCases = {
  getNode,
  saveNode,
  getChunkData,
  getChunksData,
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
