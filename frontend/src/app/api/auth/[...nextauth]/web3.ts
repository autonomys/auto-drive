import jwt from 'jsonwebtoken';
import { getCsrfToken } from 'next-auth/react';
import { SiweMessage } from 'siwe';

export const encodeWalletProofInJWT = (walletProof: object) => {
  const stringified = JSON.stringify(walletProof);
  const secret = '<secret>';

  return jwt.sign(stringified, secret, {
    algorithm: 'none',
  });
};

export const getMessageToSign = async (address: string) => {
  const siweMessage = new SiweMessage({
    address,
    chainId: 490000,
    domain: window.location.host,
    statement: 'Sign in to Auto Drive.',
    uri: window.location.origin,
    version: '1',
    nonce: await getCsrfToken(),
    issuedAt: new Date().toISOString(),
  });
  return siweMessage.prepareMessage();
};
