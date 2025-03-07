import { NetworkId } from "@autonomys/auto-utils";
import { createAutoDriveApi } from "@autonomys/auto-drive";
import { removeFalsy, toPromise } from "./utils";
import { ApiPatternByNetwork, config } from "./config";

export const getFileNetwork = async (cid: string) => {
  const networks = [NetworkId.MAINNET, NetworkId.TAURUS] as const;

  const results = removeFalsy(
    await toPromise(
      networks.map(async (network) => {
        const api = createAutoDriveApi({
          network: network,
          apiKey: config.autoDriveApiKey,
        });

        const object = await api.searchByNameOrCID(cid);
        const fileExists = object.length > 0;
        const endpoint = ApiPatternByNetwork[network]?.replace("{cid}", cid);
        const url = `${endpoint}?ignoreEncoding=false`;

        if (fileExists && endpoint) {
          const file = object[0];
          return {
            type: file.type,
            url,
          };
        }

        return null;
      })
    )
  );

  return results.at(0);
};
