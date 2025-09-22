import { Address } from "viem";
import { NetworkId } from "./networks";

export const depositContractsByNetworkId: Record<NetworkId, Address> = {
  [NetworkId.TAURUS]: "0x0000000000000000000000000000000000000000",
  [NetworkId.MAINNET]: "0x0000000000000000000000000000000000000000",
  [NetworkId.LOCAL]: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
};

export const depositAbi = [
  {
    inputs: [{ name: "intentId", type: "bytes32" }],
    name: "deposit",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
] as const;
