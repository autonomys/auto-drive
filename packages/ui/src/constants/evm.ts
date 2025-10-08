import { NetworkId } from './networks'
import { Chain } from 'wagmi/chains'

export const evmChains: Record<NetworkId, Chain> = {
  [NetworkId.MAINNET]: {
    id: 870,
    name: 'Mainnet',
    nativeCurrency: {
      name: 'AI3',
      symbol: 'AI3',
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: ['https://auto-evm.mainnet.autonomys.xyz/ws'],
      },
    },
  },
  [NetworkId.LOCAL]: {
    // Anvil default chain id
    id: 8700,
    name: 'Chronos Testnet',
    nativeCurrency: {
      name: 'Chronos AI3',
      symbol: 'tAI3',
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: ['https://auto-evm.chronos.autonomys.xyz/ws'],
      },
    },
  },
}
