import {
  cidOfNode,
  cidToString,
  decodeIPLDNodeData,
  MetadataType,
  encodeNode,
  IPLDNodeData,
} from "@autonomys/auto-drive";
import { nodesRepository } from "../repositories/nodes.js";
import { PBNode } from "@ipld/dag-pb";
import { CID } from "multiformats";

export const getNode = async (
  cid: string | CID
): Promise<string | undefined> => {
  let cidString = typeof cid === "string" ? cid : cidToString(cid);
  const node = await nodesRepository.getNode(cidString);
  if (!node) {
    return undefined;
  }

  return node.encoded_node;
};

export const saveNode = async (
  head_cid: string | CID,
  cid: string | CID,
  type: MetadataType,
  encodedNode: string
) => {
  let headCidString =
    typeof head_cid === "string" ? head_cid : cidToString(head_cid);
  let cidString = typeof cid === "string" ? cid : cidToString(cid);

  await nodesRepository.saveNode({
    cid: cidString,
    head_cid: headCidString,
    type,
    encoded_node: encodedNode,
  });
};

export const getChunkData = async (
  cid: string | CID
): Promise<Buffer | undefined> => {
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

export const saveNodesWithHeadCID = async (
  nodes: PBNode[],
  headCid: string | CID
) => {
  return Promise.all(
    nodes.map((node) => {
      const cid = cidToString(cidOfNode(node));
      const { type } = IPLDNodeData.decode(node.Data!);
      saveNode(headCid, cid, type, encodeNode(node).toString("base64"));
    })
  );
};
