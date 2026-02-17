import { getClientRuntimeConfig } from '@/config/RuntimeConfigProvider';

export const getApiBaseUrl = (): string => {
  if (typeof window !== 'undefined') {
    return getClientRuntimeConfig().authApiUrl;
  }
  return process.env.NEXT_PUBLIC_AUTH_API_URL || 'http://localhost:3030';
};
