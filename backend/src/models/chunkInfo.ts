import { cidOfNode, cidToString } from "@autonomys/auto-drive";
import { encode, PBNode } from "@ipld/dag-pb";

export interface ChunkInfo {
  size: number;
  cid: string;
}

export const chunkInfoFromNode = (node: PBNode): ChunkInfo => {
  const encoded = encode(node);

  return {
    size: encoded.length,
    cid: cidToString(cidOfNode(node)),
  };
};
