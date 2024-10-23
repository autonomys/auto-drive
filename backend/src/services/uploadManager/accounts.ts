import { Keyring } from "@polkadot/api";

export const getAccounts = () => {
  const privateKeys = process.env.PRIVATE_KEYS_PATH ?? "//Alice";
  const privateKeysArray = privateKeys
    .split(",")
    .map((key) => key.trim())
    .filter((e) => e.length > 0);

  const keyring = new Keyring({ type: "sr25519" });

  privateKeysArray.forEach((key) => keyring.addFromUri(key));

  return keyring.getPairs();
};

export const getAccount = (address: string) => {
  const accounts = getAccounts();
  return accounts.find((account) => account.address === address);
};
