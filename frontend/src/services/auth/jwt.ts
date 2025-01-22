import { UserInfo } from '../../models/User';
import { API_BASE_URL } from './config';

export const checkAuth = async (
  provider?: string,
  token?: string,
): Promise<UserInfo> => {
  if (!provider || !token) {
    throw new Error('Provider or token is not defined');
  }

  const response = await fetch(`${API_BASE_URL}/users/@me`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Auth-Provider': provider,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch user');
  }

  return response.json() as Promise<UserInfo>;
};
