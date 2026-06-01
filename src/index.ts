#!/usr/bin/env node
import { readFileSync } from "fs";
import { join } from "path";
import { parseCommands, wantsVersion, USAGE } from "./lib/commands";
import { CurtabApp } from "./tui";

/** Read curtab's version from the package.json shipped alongside dist/. */
function readVersion(): string {
  const pkgPath = join(__dirname, "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
  return pkg.version ?? "unknown";
}

function main(): void {
  const argv = process.argv.slice(2);

  if (wantsVersion(argv)) {
    process.stdout.write(readVersion() + "\n");
    process.exit(0);
  }

  const commands = parseCommands(argv);

  if (commands.length === 0) {
    process.stderr.write(USAGE + "\n");
    process.exit(1);
  }

  const app = new CurtabApp(commands);
  app.start();
}

main();
