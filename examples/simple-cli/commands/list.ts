import { Command, Option } from "commander";
import { api } from "../services/api.js";
import { getRoots, Scope } from "@autonomys/auto-drive";

export const listCommand = new Command("ls")
  .addOption(
    new Option(
      "-s, --scope <scope>",
      "The scope to list the roots for (user or global)"
    )
      .choices(["user", "global"])
      .default("user")
  )
  .option("-l, --limit <limit>", "The limit of roots to list", "100")
  .option("-o, --offset <offset>", "The offset of roots to list", "0")
  .action(async (options) => {
    const roots = await getRoots(api, {
      scope: options.scope as Scope,
      limit: options.limit,
      offset: options.offset,
    });

    roots.rows.forEach((root) => {
      console.log(`${root.headCid}: ${root.name}`);
    });
  });
