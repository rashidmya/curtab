import { describe, it, expect } from "vitest";
import {
  parseCommands,
  parseArgs,
  buildShellInvocation,
  statusIcon,
  tabLabel,
  classifyInput,
  SHORT_USAGE,
  USAGE,
} from "./commands";

describe("parseCommands", () => {
  it("treats each argv item as one full command without splitting on spaces", () => {
    const result = parseCommands(["npm run dev", "npm run api"]);
    expect(result).toEqual(["npm run dev", "npm run api"]);
  });

  it("preserves the command list verbatim and in order", () => {
    const input = ["echo a", "sleep 1 && echo b", "ping -c 1 localhost"];
    expect(parseCommands(input)).toEqual(input);
  });

  it("does not merge or re-split multiple unquoted words", () => {
    // Six separate argv items -> six separate commands.
    const result = parseCommands(["npm", "run", "dev", "npm", "run", "api"]);
    expect(result).toEqual(["npm", "run", "dev", "npm", "run", "api"]);
    expect(result).toHaveLength(6);
  });

  it("ignores empty / whitespace-only arguments", () => {
    expect(parseCommands(["echo a", "", "  ", "echo b"])).toEqual([
      "echo a",
      "echo b",
    ]);
  });

  it("returns an empty array when given no arguments", () => {
    expect(parseCommands([])).toEqual([]);
  });
});

describe("USAGE", () => {
  it("mentions the binary name and full options", () => {
    expect(USAGE).toContain("curtab");
    expect(USAGE.toLowerCase()).toContain("usage");
    expect(USAGE).toContain("--names");
  });
});

describe("SHORT_USAGE", () => {
  it("is a terse two-line message pointing at --help", () => {
    expect(parseCommands([])).toHaveLength(0);
    expect(SHORT_USAGE).toContain("Usage: curtab");
    expect(SHORT_USAGE).toContain("Try 'curtab --help'");
    // Stays short — full option list lives in USAGE / --help.
    expect(SHORT_USAGE.split("\n")).toHaveLength(2);
  });
});

describe("parseArgs", () => {
  it("treats bare positional arguments as commands", () => {
    const result = parseArgs(["npm run dev", "npm run api"]);
    expect(result.commands).toEqual(["npm run dev", "npm run api"]);
    expect(result.names).toEqual([]);
    expect(result.help).toBe(false);
    expect(result.version).toBe(false);
  });

  it("sets version for --version and -v", () => {
    expect(parseArgs(["--version"]).version).toBe(true);
    expect(parseArgs(["-v"]).version).toBe(true);
  });

  it("sets help for --help and -h", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  it("parses --names as a comma-separated, trimmed list", () => {
    const result = parseArgs(["--names", "web, api ,worker", "a", "b", "c"]);
    expect(result.names).toEqual(["web", "api", "worker"]);
    expect(result.commands).toEqual(["a", "b", "c"]);
  });

  it("accepts the -n short flag and the --names=value form", () => {
    expect(parseArgs(["-n", "web, api", "a", "b"]).names).toEqual([
      "web",
      "api",
    ]);
    expect(parseArgs(["--names=web, api", "a", "b"]).names).toEqual([
      "web",
      "api",
    ]);
  });

  it("does not leak the names flag or its value into commands", () => {
    const result = parseArgs(["npm run dev", "-n", "dev,api", "npm run api"]);
    expect(result.commands).toEqual(["npm run dev", "npm run api"]);
    expect(result.names).toEqual(["dev", "api"]);
  });

  it("treats a trailing names flag with no value as no names", () => {
    expect(parseArgs(["a", "--names"]).names).toEqual([]);
  });

  it("ignores empty / whitespace-only command arguments", () => {
    expect(parseArgs(["echo a", "", "  ", "echo b"]).commands).toEqual([
      "echo a",
      "echo b",
    ]);
  });
});

describe("buildShellInvocation", () => {
  it("uses the user's SHELL with -lc on unix-like platforms", () => {
    const result = buildShellInvocation("npm run dev", {
      platform: "linux",
      env: { SHELL: "/bin/zsh" },
    });
    expect(result).toEqual({
      shell: "/bin/zsh",
      args: ["-lc", "npm run dev"],
    });
  });

  it("falls back to bash when SHELL is not set on unix", () => {
    const result = buildShellInvocation("echo hi", {
      platform: "darwin",
      env: {},
    });
    expect(result).toEqual({ shell: "bash", args: ["-lc", "echo hi"] });
  });

  it("uses cmd.exe with /d /s /c on windows", () => {
    const result = buildShellInvocation("npm run dev", {
      platform: "win32",
      env: { SHELL: "/bin/zsh" },
    });
    expect(result).toEqual({
      shell: "cmd.exe",
      args: ["/d", "/s", "/c", "npm run dev"],
    });
  });

  it("does not split the command string into separate args", () => {
    const result = buildShellInvocation("npm run dev -- --port 3000", {
      platform: "linux",
      env: { SHELL: "/bin/bash" },
    });
    expect(result.args[result.args.length - 1]).toBe(
      "npm run dev -- --port 3000",
    );
  });
});

describe("statusIcon", () => {
  it("shows a filled dot while running", () => {
    expect(statusIcon("running")).toBe("●");
  });

  it("shows a check when exited successfully (code 0)", () => {
    expect(statusIcon("exited", 0)).toBe("✓");
  });

  it("shows a cross when exited with a non-zero code", () => {
    expect(statusIcon("exited", 1)).toBe("✕");
  });

  it("shows a square when killed", () => {
    expect(statusIcon("killed")).toBe("■");
  });
});

describe("tabLabel", () => {
  it("combines the icon, tab number and name", () => {
    const label = tabLabel({ id: 0, name: "npm run dev", status: "running" });
    expect(label).toContain("●");
    expect(label).toContain("1");
    expect(label).toContain("npm run dev");
  });
});

describe("classifyInput", () => {
  it("maps Ctrl+C to quit", () => {
    expect(classifyInput("\x03")).toEqual({ kind: "quit" });
  });

  it("maps Alt+R to restart and Alt+K to kill", () => {
    expect(classifyInput("\x1br")).toEqual({ kind: "restart" });
    expect(classifyInput("\x1bk")).toEqual({ kind: "kill" });
  });

  it("maps Alt+<digit> to a 0-based tab index", () => {
    expect(classifyInput("\x1b1")).toEqual({ kind: "switchTab", index: 0 });
    expect(classifyInput("\x1b9")).toEqual({ kind: "switchTab", index: 8 });
  });

  it("does not treat Alt+0 as a tab switch (no tab 0)", () => {
    expect(classifyInput("\x1b0")).toEqual({ kind: "forward" });
  });

  it("maps every Shift/Alt PageUp encoding to a page scroll up", () => {
    for (const seq of ["\x1b[5;2~", "\x1b[5$", "\x1b[5;3~"]) {
      expect(classifyInput(seq)).toEqual({
        kind: "scroll",
        direction: -1,
        unit: "page",
      });
    }
  });

  it("maps every PageDown encoding to a page scroll down", () => {
    for (const seq of ["\x1b[6;2~", "\x1b[6$", "\x1b[6;3~"]) {
      expect(classifyInput(seq)).toEqual({
        kind: "scroll",
        direction: 1,
        unit: "page",
      });
    }
  });

  it("forwards ordinary keystrokes and unrecognized sequences", () => {
    expect(classifyInput("a")).toEqual({ kind: "forward" });
    expect(classifyInput("\x1bOA")).toEqual({ kind: "forward" }); // arrow up
    expect(classifyInput("")).toEqual({ kind: "forward" });
  });
});
