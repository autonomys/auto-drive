import { createRequire } from 'node:module'
import type * as PolkadotApi from '@polkadot/api'
import type * as PolkadotUtil from '@polkadot/util'
import type * as PolkadotUtilCrypto from '@polkadot/util-crypto'

// The Auto SDK is CommonJS, so it loads the CommonJS build of @polkadot.
// Importing @polkadot from this ESM package would load the ESM build as well,
// a second instance of every @polkadot module, so the backend takes its
// @polkadot values from here and imports only types from @polkadot directly.
const require = createRequire(import.meta.url)

export const { ApiPromise, Keyring, WsProvider } =
  require('@polkadot/api') as typeof PolkadotApi
export type ApiPromise = PolkadotApi.ApiPromise

export const { compactAddLength } =
  require('@polkadot/util') as typeof PolkadotUtil

export const { cryptoWaitReady } =
  require('@polkadot/util-crypto') as typeof PolkadotUtilCrypto
