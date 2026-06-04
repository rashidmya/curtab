#!/usr/bin/env node
import { readFileSync } from "fs";
import { join } from "path";
import { parseArgs, SHORT_USAGE, USAGE } from "./lib/commands";
import { CurtabApp } from "./tui";

/** Read curtab's version from the package.json shipped alongside dist/. */
function readVersion(): string {
  const pkgPath = join(__dirname, "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
  return pkg.version ?? "unknown";
}

function main(): void {
  const { commands, names, color, help, version } = parseArgs(process.argv.slice(2));

  if (help) {
    process.stdout.write(USAGE + "\n");
    process.exit(0);
  }

  if (version) {
    process.stdout.write(readVersion() + "\n");
    process.exit(0);
  }

  if (commands.length === 0) {
    process.stderr.write(SHORT_USAGE + "\n");
    process.exit(1);
  }

  const app = new CurtabApp(commands, names, color);
  app.start();
}

main();
