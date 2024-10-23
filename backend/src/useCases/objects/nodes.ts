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

export const NodesUseCases = {
  getNode,
  saveNode,
  getChunkData,
  saveNodes,
};
