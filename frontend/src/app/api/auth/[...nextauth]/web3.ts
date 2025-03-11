import jwt from 'jsonwebtoken';

export const encodeWalletProofInJWT = (walletProof: object) => {
  const stringified = JSON.stringify(walletProof);
  const secret = '<secret>';

  return jwt.sign(stringified, secret, {
    algorithm: 'none',
  });
};

export const decodeWalletProofFromJWT = (token: string) => {
  return jwt.verify(token, '', {});
};
