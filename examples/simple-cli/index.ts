import { program } from "commander";
import { publishCommand } from "./commands/publish.js";
import { downloadCommand } from "./commands/download.js";
import { listCommand } from "./commands/list.js";

program
  .version("0.0.1")
  .description("Auto-Drive CLI")
  .addCommand(publishCommand)
  .addCommand(downloadCommand)
  .addCommand(listCommand);

program.parse(process.argv);
