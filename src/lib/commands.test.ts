import { describe, it, expect } from "vitest";
import {
  parseCommands,
  buildShellInvocation,
  statusIcon,
  tabLabel,
  classifyInput,
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
  it("is shown when no commands are provided and mentions the binary name", () => {
    expect(parseCommands([])).toHaveLength(0);
    expect(USAGE).toContain("curtab");
    expect(USAGE.toLowerCase()).toContain("usage");
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

  it("maps mouse wheel reports to a wheel scroll", () => {
    expect(classifyInput("\x1b[<64;10;5M")).toEqual({
      kind: "scroll",
      direction: -1,
      unit: "wheel",
    }); // SGR wheel up
    expect(classifyInput("\x1b[<65;10;5M")).toEqual({
      kind: "scroll",
      direction: 1,
      unit: "wheel",
    }); // SGR wheel down
    expect(classifyInput("\x1b[M\x60\x30\x30")).toEqual({
      kind: "scroll",
      direction: -1,
      unit: "wheel",
    }); // X10 wheel up (button 96)
  });

  it("ignores non-wheel mouse reports so they never reach the PTY", () => {
    expect(classifyInput("\x1b[<35;10;5M")).toEqual({ kind: "ignore" }); // SGR move
    expect(classifyInput("\x1b[M\x20\x40\x40")).toEqual({ kind: "ignore" }); // X10 click
  });

  it("forwards ordinary keystrokes and unrecognized sequences", () => {
    expect(classifyInput("a")).toEqual({ kind: "forward" });
    expect(classifyInput("\x1bOA")).toEqual({ kind: "forward" }); // arrow up
    expect(classifyInput("")).toEqual({ kind: "forward" });
  });
});
