#!/usr/bin/env node
import { parseCommands, USAGE } from "./lib/commands";
import { CurtabApp } from "./tui";

function main(): void {
  const commands = parseCommands(process.argv.slice(2));

  if (commands.length === 0) {
    process.stderr.write(USAGE + "\n");
    process.exit(1);
  }

  const app = new CurtabApp(commands);
  app.start();
}

main();
