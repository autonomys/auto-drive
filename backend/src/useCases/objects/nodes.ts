import {
  cidOfNode,
  cidToString,
  decodeIPLDNodeData,
  encodeNode,
  IPLDNodeData,
  MetadataType,
} from "@autonomys/auto-drive";
import { PBNode } from "@ipld/dag-pb";
import { CID } from "multiformats";
import { nodesRepository } from "../../repositories/index.js";
import { uploadsRepository } from "../../repositories/uploads/uploads.js";
import { getUploadBlockstore } from "../../services/uploadProcessorCache/index.js";
import {
  asyncIterableForEach,
  asyncIterableToPromiseOfArray,
} from "../../utils/async.js";
import { BlockstoreUseCases } from "../uploads/blockstore.js";
import { blockstoreRepository } from "../../repositories/uploads/blockstore.js";

const getNode = async (cid: string | CID): Promise<string | undefined> => {
  let cidString = typeof cid === "string" ? cid : cidToString(cid);
  const node = await nodesRepository.getNode(cidString);
  if (!node) {
    return undefined;
  }

  return node.encoded_node;
};

const saveNode = async (
  rootCid: string | CID,
  headCid: string | CID,
  cid: string | CID,
  type: MetadataType,
  encodedNode: string
) => {
  const headCidString =
    typeof headCid === "string" ? headCid : cidToString(headCid);
  const rootCidString =
    typeof rootCid === "string" ? rootCid : cidToString(rootCid);
  const cidString = typeof cid === "string" ? cid : cidToString(cid);

  await nodesRepository.saveNode({
    root_cid: rootCidString,
    head_cid: headCidString,
    cid: cidString,
    type,
    encoded_node: encodedNode,
  });
};

const getChunkData = async (cid: string | CID): Promise<Buffer | undefined> => {
  let cidString = typeof cid === "string" ? cid : cidToString(cid);
  const node = await nodesRepository.getNode(cidString);
  if (!node) {
    return undefined;
  }

  const chunkData = decodeIPLDNodeData(
    Buffer.from(node.encoded_node, "base64")
  ).data;

  if (!chunkData) {
    return undefined;
  }

  return Buffer.from(chunkData);
};

const saveNodes = async (
  rootCid: string | CID,
  headCid: string | CID,
  nodes: PBNode[]
) => {
  return Promise.all(
    nodes.map((node) => {
      const cid = cidToString(cidOfNode(node));
      const { type } = IPLDNodeData.decode(node.Data!);
      saveNode(
        rootCid,
        headCid,
        cid,
        type,
        encodeNode(node).toString("base64")
      );
    })
  );
};

const migrateFromBlockstoreToNodesTable = async (
  uploadId: string
): Promise<void> => {
  const uploads = await uploadsRepository.getUploadsByRoot(uploadId);
  const uploadCID = await BlockstoreUseCases.getFileUploadIdCID(uploadId);

  for (const upload of uploads) {
    const blockstore = await getUploadBlockstore(upload.id);

    const BATCH_SIZE = 100;
    await asyncIterableForEach(
      blockstore.getAllKeys(),
      async (batch) => {
        const nodes = await asyncIterableToPromiseOfArray(
          blockstore.getMany(batch)
        );
        await nodesRepository.saveNodes(
          nodes.map((e) => ({
            cid: cidToString(e.cid),
            root_cid: cidToString(uploadCID),
            head_cid: cidToString(uploadCID),
            type: decodeIPLDNodeData(Buffer.from(e.block)).type,
            encoded_node: Buffer.from(e.block).toString("base64"),
          }))
        );
      },
      BATCH_SIZE
    );
  }
};

export const NodesUseCases = {
  getNode,
  saveNode,
  getChunkData,
  saveNodes,
  migrateFromBlockstoreToNodesTable,
};
