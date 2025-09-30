import { NetworkId } from "./networks";
import { Chain } from "wagmi/chains";
import {
  getNetworkDomainRpcUrls,
  NetworkId as AutoUtilsNetworkId,
  DomainRuntime,
} from "@autonomys/auto-utils";

export const evmChains: Record<NetworkId, Chain> = {
  [NetworkId.MAINNET]: {
    id: 870,
    name: "Mainnet",
    nativeCurrency: {
      name: "AI3",
      symbol: "AI3",
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: getNetworkDomainRpcUrls({
          networkId: AutoUtilsNetworkId.MAINNET,
          domainId: "0",
        }),
      },
    },
  },
  [NetworkId.TAURUS]: {
    id: 490000,
    name: "Taurus",
    nativeCurrency: {
      name: "Taurus AI3",
      symbol: "tAI3",
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: getNetworkDomainRpcUrls({
          networkId: AutoUtilsNetworkId.TAURUS,
          domainId: "0",
        }),
      },
    },
  },
  [NetworkId.LOCAL]: {
    // Anvil default chain id
    id: 8700,
    name: "Chronos Testnet",
    nativeCurrency: {
      name: "Chronos AI3",
      symbol: "tAI3",
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: ["https://auto-evm.chronos.autonomys.xyz/ws"],
      },
    },
  },
};
