import jwt from 'jsonwebtoken';
import { SiweMessage } from 'siwe';
import { API_BASE_URL } from 'services/auth/config';

export const encodeWalletProofInJWT = (walletProof: object) => {
  const stringified = JSON.stringify(walletProof);
  const secret = '<secret>';

  return jwt.sign(stringified, secret, {
    algorithm: 'none',
  });
};

const getNonce = async (): Promise<{ nonce: string; expiresAt: string }> => {
  const response = await fetch(`${API_BASE_URL}/users/web3/nonce`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`Failed to get sign-in nonce: ${response.statusText}`);
  }

  return response.json();
};

export const getMessageToSign = async (address: string) => {
  const { nonce, expiresAt } = await getNonce();
  const siweMessage = new SiweMessage({
    address,
    chainId: 490000,
    domain: window.location.host,
    statement: 'Sign in to Auto Drive.',
    uri: window.location.origin,
    version: '1',
    nonce,
    issuedAt: new Date().toISOString(),
    expirationTime: expiresAt,
  });
  return siweMessage.prepareMessage();
};
