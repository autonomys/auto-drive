import type { IPLDNodeData } from "@autonomys/auto-drive";

export interface NodeWithMetadata {
  cid: string;
  metadata: IPLDNodeData;
  links: string[];
}
