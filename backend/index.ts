import { ApiPromise, WsProvider } from "@polkadot/api";
import {} from "@polkadot/rpc-core";
import "dotenv/config";

async function main() {
  const provider = new WsProvider(
    "wss://autoid-0.gemini-3h.subspace.network/ws",
  );

  const api = await ApiPromise.create({
    provider,
  });

  const pendingExtrinsics = await api.rpc.author.pendingExtrinsics();

  console.log(
    pendingExtrinsics.map((e) => ({
      hash: e.hash.toHex(),
      method: e.method.toHuman(),
      nonce: e.nonce.toHuman(),
      signature: e.signature.toHuman(),
    })),
  );
}

main();
