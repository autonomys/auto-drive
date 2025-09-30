import { NetworkId } from "@autonomys/auto-utils";
import { createAutoDriveApi } from "@autonomys/auto-drive";
import { firstNonNull } from "./utils";
import { ApiPatternByNetwork, config } from "./config";

export const getFileNetwork = async (cid: string) => {
  const networks = [NetworkId.MAINNET, NetworkId.TAURUS] as const;

  // Create reusable API instances to avoid memory leaks
  const apiInstances = {
    [NetworkId.MAINNET]: createAutoDriveApi({
      network: NetworkId.MAINNET,
      apiKey: config.autoDriveApiKey,
    }),
  };

  const promises = networks.map(async (network) => {
    try {
      const api = apiInstances[network];
      const object = await api.searchByNameOrCID(cid);
      const fileExists = object.length > 0;
      const url = ApiPatternByNetwork[network]?.replace("{cid}", cid);

      if (fileExists && url) {
        const file = object[0];
        return {
          type: file.type,
          url,
          network,
        };
      }

      return null;
    } catch (error) {
      console.error(`Error searching network ${network}:`, error);
      return null;
    }
  });

  return await firstNonNull(promises);
};
