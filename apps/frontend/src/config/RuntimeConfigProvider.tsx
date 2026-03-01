'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { RuntimeConfig } from './runtime';

let _clientConfig: RuntimeConfig | null = null;

export function getClientRuntimeConfig(): RuntimeConfig {
  if (!_clientConfig) {
    throw new Error(
      'Runtime config not initialized. Ensure RuntimeConfigProvider is mounted.',
    );
  }
  return _clientConfig;
}

const RuntimeConfigContext = createContext<RuntimeConfig | null>(null);

export function RuntimeConfigProvider({
  config,
  children,
}: {
  config: RuntimeConfig;
  children: ReactNode;
}) {
  _clientConfig = config;

  return (
    <RuntimeConfigContext.Provider value={config}>
      {children}
    </RuntimeConfigContext.Provider>
  );
}

export function useRuntimeConfig(): RuntimeConfig {
  const config = useContext(RuntimeConfigContext);
  if (!config)
    throw new Error(
      'useRuntimeConfig must be used within RuntimeConfigProvider',
    );
  return config;
}
