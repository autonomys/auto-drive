import { Argument, Command } from "commander";
import { api } from "../services/api.js";
import { createWriteStream } from "fs";

export const downloadCommand = new Command("download")
  .addArgument(new Argument("cid", "The CID of the file to download"))
  .option("-p, --password <password>", "The password to use for the file")
  .option("-o, --output <output>", "The path to save the file to")
  .action(async (cid, options) => {
    const iterable = await api.downloadFile(cid, options.password);
    if (options.output) {
      await saveIterableInFile(iterable, options.output);
    } else {
      await logIterable(iterable);
    }
  });

const saveIterableInFile = async (
  iterable: AsyncIterable<Uint8Array>,
  output: string
) => {
  const writable = createWriteStream(output);
  for await (const chunk of iterable) {
    writable.write(chunk);
  }
  writable.close();
};

const logIterable = async (iterable: AsyncIterable<Uint8Array>) => {
  let buffer = Buffer.alloc(0);
  for await (const chunk of iterable) {
    buffer = Buffer.concat([buffer, chunk]);
  }
  console.log(buffer.toString("utf-8"));
};
