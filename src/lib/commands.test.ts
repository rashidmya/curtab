import { describe, expect, it } from "vitest";
import {
  buildShellInvocation,
  classifyInput,
  parseArgs,
  statusColor,
  statusIcon,
  tabLabel,
} from "./commands";

describe("parseArgs", () => {
  it("treats each positional as one whole command", () => {
    const { commands } = parseArgs(["npm run dev", "npm run api"]);
    expect(commands).toEqual(["npm run dev", "npm run api"]);
  });
  it("parses names, help, and version flags", () => {
    expect(parseArgs(["-n", "web, api", "a", "b"])).toMatchObject({
      commands: ["a", "b"],
      names: ["web", "api"],
    });
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-v"]).version).toBe(true);
  });
  it("defaults color off and enables it with -c / --color", () => {
    expect(parseArgs(["a"]).color).toBe(false);
    expect(parseArgs(["-c", "a"])).toMatchObject({ color: true, commands: ["a"] });
    expect(parseArgs(["--color", "a"]).color).toBe(true);
  });
});

describe("buildShellInvocation", () => {
  it("runs the command as a single shell argument on unix", () => {
    expect(
      buildShellInvocation("echo hi", { platform: "linux", env: { SHELL: "zsh" } }),
    ).toEqual({ shell: "zsh", args: ["-lc", "echo hi"] });
  });
  it("uses cmd.exe on win32", () => {
    expect(
      buildShellInvocation("dir", { platform: "win32", env: {} }),
    ).toEqual({ shell: "cmd.exe", args: ["/d", "/s", "/c", "dir"] });
  });
});

describe("status labels", () => {
  it("maps status to a glyph", () => {
    expect(statusIcon("running")).toBe("●");
    expect(statusIcon("killed")).toBe("■");
    expect(statusIcon("exited", 0)).toBe("✓");
    expect(statusIcon("exited", 1)).toBe("✕");
  });
  it("renders a 1-based label", () => {
    expect(tabLabel({ id: 0, name: "web", status: "running" })).toBe("● 1:web");
  });
  it("maps status to an ANSI foreground color code", () => {
    expect(statusColor("running")).toBe(36); // cyan
    expect(statusColor("killed")).toBe(90); // bright black / muted
    expect(statusColor("exited", 0)).toBe(32); // green
    expect(statusColor("exited", 1)).toBe(31); // red
  });
});

describe("classifyInput — leader state machine", () => {
  it("forwards ordinary keystrokes to the PTY", () => {
    expect(classifyInput("a")).toEqual({
      action: { kind: "forward" },
      leaderPending: false,
    });
  });
  it("quits on Ctrl+C", () => {
    expect(classifyInput("\x03").action).toEqual({ kind: "quit" });
  });
  it("arms the leader on Ctrl+B and consumes it", () => {
    expect(classifyInput("\x02")).toEqual({
      action: { kind: "ignore" },
      leaderPending: true,
    });
  });
  it("switches tabs with a digit after the leader", () => {
    expect(classifyInput("2", true)).toEqual({
      action: { kind: "switchTab", index: 1 },
      leaderPending: false,
    });
  });
  it("cycles with n/p after the leader", () => {
    expect(classifyInput("n", true).action).toEqual({ kind: "cycleTab", delta: 1 });
    expect(classifyInput("p", true).action).toEqual({ kind: "cycleTab", delta: -1 });
  });
  it("restarts and kills with r/k after the leader", () => {
    expect(classifyInput("r", true).action).toEqual({ kind: "restart" });
    expect(classifyInput("k", true).action).toEqual({ kind: "kill" });
  });
  it("forwards a literal Ctrl+B when the leader is doubled", () => {
    expect(classifyInput("\x02", true).action).toEqual({
      kind: "forward",
      data: "\x02",
    });
  });
  it("consumes an unbound key after the leader", () => {
    expect(classifyInput("z", true).action).toEqual({ kind: "ignore" });
  });
  it("handles leader + command arriving in one buffer", () => {
    expect(classifyInput("\x023").action).toEqual({ kind: "switchTab", index: 2 });
  });
});

describe("classifyInput — scrolling & mouse", () => {
  it("scrolls up one line on wheel-up (SGR button 64)", () => {
    expect(classifyInput("\x1b[<64;10;5M").action).toEqual({
      kind: "scroll",
      direction: -1,
      unit: "line",
    });
  });
  it("scrolls down one line on wheel-down (SGR button 65)", () => {
    expect(classifyInput("\x1b[<65;10;5M").action).toEqual({
      kind: "scroll",
      direction: 1,
      unit: "line",
    });
  });
  it("pages with Shift+PageUp / Shift+PageDown", () => {
    expect(classifyInput("\x1b[5;2~").action).toEqual({
      kind: "scroll",
      direction: -1,
      unit: "page",
    });
    expect(classifyInput("\x1b[6;2~").action).toEqual({
      kind: "scroll",
      direction: 1,
      unit: "page",
    });
  });
  it("drops non-wheel mouse reports instead of forwarding them", () => {
    expect(classifyInput("\x1b[<0;10;5M").action).toEqual({ kind: "ignore" });
    expect(classifyInput("\x1b[<0;10;5m").action).toEqual({ kind: "ignore" });
  });
});
