import { Argument, Command } from "commander";
import autoDrive from "@autonomys/auto-drive";
import { api } from "../services/api.js";

export const publishCommand = new Command("publish")
  .addArgument(new Argument("path", "The path to the file to publish"))
  .option("-p, --password <password>", "The password to use for the file")
  .option("--no-compression", "Whether to not compress the file", false)
  .action(async (path, options) => {
    await autoDrive
      .uploadFileFromFilepath(api, path, {
        password: options.password,
        compression: options.compression,
        onProgress: (progress) => {
          console.log(`Progress: ${progress}%`);
        },
      })
      .then((cid) => {
        console.log(`Published file with CID: ${cid}`);
      })
      .catch((e) => {
        console.error(e);
      });
  });
