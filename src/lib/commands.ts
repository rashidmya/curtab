/* eslint-disable no-control-regex -- input decoding matches terminal control sequences by design */
/**
 * Pure, side-effect-free logic for curtab.
 *
 * Everything here is deliberately decoupled from node-pty and the TUI layer so
 * it can be unit tested without spawning real processes or a terminal.
 */

export type TabStatus = "running" | "exited" | "killed";

/** Terse message shown when curtab is run with no commands (cf. grep, ls). */
export const SHORT_USAGE = `Usage: curtab [options] '<command 1>' '<command 2>' [...]
Try 'curtab --help' for more information.`;

export const USAGE = `curtab — run each command in its own interactive terminal tab.

Usage:
  curtab [options] '<command 1>' '<command 2>' [...]

Each positional argument is ONE full command and is run through your shell.
Commands containing spaces must be quoted (use double quotes on Windows).

Options:
  -n, --names 'a,b'   Custom tab names (comma-separated), matched to commands
                       in order. Missing names fall back to the command text.
  -c, --color          Color-code tab status (running/ok/error/killed).
  -h, --help           Show this help and exit.
  -v, --version        Print the curtab version and exit.

Examples:
  curtab 'npm run dev' 'npm run api'
  curtab -c -n 'web, api' 'npm run dev' 'npm run api'
`;

/**
 * Turn raw argv (already split by the shell) into a clean command list.
 *
 * IMPORTANT: each argv entry is treated as one complete command. We never split
 * a command on spaces, and we never join multiple args back together.
 */
export function parseCommands(argv: string[]): string[] {
  return argv.map((arg) => arg.trim()).filter((arg) => arg.length > 0);
}

/** Split a `--names` value ("web, api") into trimmed names; "" yields []. */
function parseNames(value: string): string[] {
  if (value.trim().length === 0) return [];
  return value.split(",").map((name) => name.trim());
}

/** Split a `--cwd` value ("web, api") into trimmed dirs; "" yields []. */
function parseCwds(value: string): string[] {
  if (value.trim().length === 0) return [];
  return value.split(",").map((dir) => dir.trim());
}

/** The result of parsing curtab's command-line arguments. */
export interface ParsedArgs {
  /** Positional commands, one per tab, in order. */
  commands: string[];
  /** Custom tab names from `-n`/`--names`, matched to commands positionally. */
  names: string[];
  /** Per-command working directories from `--cwd`, matched to commands positionally. */
  cwds: string[];
  /** `-c`/`--color` was given — tint the tab bar by status. Off by default. */
  color: boolean;
  /** `-h`/`--help` was given. */
  help: boolean;
  /** `-v`/`--version` was given. */
  version: boolean;
}

/**
 * Parse raw argv (already split by the shell) into commands, names, and flags.
 *
 * Flags and their values are stripped out so they never become commands. Each
 * remaining positional argument is treated as one complete command (never split
 * on spaces). Names map to commands by position; the TUI falls back to the
 * command text for any tab without a name.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const commands: string[] = [];
  let names: string[] = [];
  let cwds: string[] = [];
  let color = false;
  let help = false;
  let version = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--version" || arg === "-v") {
      version = true;
    } else if (arg === "--color" || arg === "-c") {
      color = true;
    } else if (arg === "--names" || arg === "-n") {
      names = parseNames(argv[++i] ?? ""); // value is the next token
    } else if (arg.startsWith("--names=")) {
      names = parseNames(arg.slice("--names=".length));
    } else if (arg.startsWith("-n=")) {
      names = parseNames(arg.slice("-n=".length));
    } else if (arg === "--cwd") {
      cwds = parseCwds(argv[++i] ?? ""); // value is the next token
    } else if (arg.startsWith("--cwd=")) {
      cwds = parseCwds(arg.slice("--cwd=".length));
    } else {
      const command = arg.trim();
      if (command.length > 0) commands.push(command);
    }
  }

  return { commands, names, cwds, color, help, version };
}

export interface ShellInvocation {
  shell: string;
  args: string[];
}

export interface ShellEnvironment {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
}

/**
 * Build the shell + args used to run a single command through the user's shell.
 *
 * The command string is always passed as a single argument so the shell parses
 * it — curtab itself never word-splits the command.
 */
export function buildShellInvocation(
  command: string,
  { platform, env }: ShellEnvironment,
): ShellInvocation {
  if (platform === "win32") {
    return { shell: "cmd.exe", args: ["/d", "/s", "/c", command] };
  }
  return { shell: env.SHELL || "bash", args: ["-lc", command] };
}

/** Status indicator glyph used in tab labels. */
export function statusIcon(status: TabStatus, exitCode?: number): string {
  switch (status) {
    case "running":
      return "●";
    case "killed":
      return "■";
    case "exited":
      return exitCode === 0 ? "✓" : "✕";
  }
}

/**
 * ANSI foreground code for a status glyph: cyan running, green clean exit, red
 * error exit, bright-black killed. Named colors so they track the terminal theme.
 */
export function statusColor(status: TabStatus, exitCode?: number): number {
  switch (status) {
    case "running":
      return 36;
    case "killed":
      return 90;
    case "exited":
      return exitCode === 0 ? 32 : 31;
  }
}

/** Render a tab label: "<icon> <1-based index>:<name>". */
export function tabLabel(tab: {
  id: number;
  name: string;
  status: TabStatus;
  exitCode?: number;
}): string {
  return `${statusIcon(tab.status, tab.exitCode)} ${tab.id + 1}:${tab.name}`;
}

// --- Keyboard input decoding ---------------------------------------------
// curtab acts on a tiny set of keys; everything else is forwarded to the
// active PTY so the running process stays fully interactive.
const CTRL_C = "\x03";
const CTRL_B = "\x02"; // leader key — press it, then a command key
// Shift+PageUp / Shift+PageDown scroll history; accept the common encodings.
const PAGE_UP_KEYS = ["\x1b[5;2~", "\x1b[5$", "\x1b[5;3~"];
const PAGE_DOWN_KEYS = ["\x1b[6;2~", "\x1b[6$", "\x1b[6;3~"];
const SGR_MOUSE = /^\x1b\[<[0-9;]+[mM]/; // ESC [ < … M/m
const X10_MOUSE = "\x1b[M"; // legacy ESC [ M b x y

/** A decoded user action, or a forward/ignore instruction for the TUI. */
export type InputAction =
  | { kind: "quit" }
  | { kind: "restart" }
  | { kind: "kill" }
  | { kind: "switchTab"; index: number } // 0-based tab index
  | { kind: "cycleTab"; delta: 1 | -1 } // relative move, wraps in the TUI
  | { kind: "scroll"; direction: 1 | -1; unit: "line" | "page" } // -1 = up (older)
  | { kind: "ignore" } // consume the key; do not reach the PTY
  | { kind: "forward"; data?: string }; // send to PTY; data overrides raw seq

/**
 * The result of decoding one input event: the action to take, plus whether the
 * leader key is now armed for the next event.
 */
export interface InputResult {
  action: InputAction;
  leaderPending: boolean;
}

/** Decode the key pressed after the leader into its action. */
function leaderCommand(seq: string): InputAction {
  if (seq.length === 1 && seq >= "1" && seq <= "9") {
    return { kind: "switchTab", index: Number(seq) - 1 };
  }
  if (seq === "n") return { kind: "cycleTab", delta: 1 };
  if (seq === "p") return { kind: "cycleTab", delta: -1 };
  if (seq === "r") return { kind: "restart" };
  if (seq === "k") return { kind: "kill" };
  if (seq === CTRL_B) return { kind: "forward", data: CTRL_B }; // literal Ctrl+B
  return { kind: "ignore" }; // unbound key — consume it, like a multiplexer
}

/** A wheel report -> a one-line scroll action, else null. (64 = up, 65 = down.) */
function wheelScroll(seq: string): InputAction | null {
  if (/^\x1b\[<64;/.test(seq)) return { kind: "scroll", direction: -1, unit: "line" };
  if (/^\x1b\[<65;/.test(seq)) return { kind: "scroll", direction: 1, unit: "line" };
  if (seq.startsWith(X10_MOUSE) && seq.length >= 4) {
    const button = seq.charCodeAt(3) - 32;
    if (button === 64) return { kind: "scroll", direction: -1, unit: "line" };
    if (button === 65) return { kind: "scroll", direction: 1, unit: "line" };
  }
  return null;
}

/** True for any terminal mouse report (SGR or legacy X10). */
function isMouseSequence(seq: string): boolean {
  return SGR_MOUSE.test(seq) || seq.startsWith(X10_MOUSE);
}

/** Decode an input event when the leader is not armed. */
function classifyUnprefixed(seq: string): InputAction {
  if (seq === CTRL_C) return { kind: "quit" };
  if (PAGE_UP_KEYS.includes(seq)) return { kind: "scroll", direction: -1, unit: "page" };
  if (PAGE_DOWN_KEYS.includes(seq)) return { kind: "scroll", direction: 1, unit: "page" };
  const wheel = wheelScroll(seq);
  if (wheel) return wheel;
  if (isMouseSequence(seq)) return { kind: "ignore" }; // non-wheel mouse: drop it
  return { kind: "forward" };
}

/**
 * Decode one raw input sequence into the action curtab should take and the next
 * leader state. This is the single source of truth for curtab's key bindings;
 * the TUI just holds `leaderPending` and dispatches on the result.
 *
 * Ctrl+B is a leader: it arms `leaderPending`, and the next event is read as a
 * command. A doubled Ctrl+B forwards a literal Ctrl+B. Otherwise the event is
 * decoded by `classifyUnprefixed` (quit, scroll, mouse-drop, or forward).
 */
export function classifyInput(seq: string, leaderPending = false): InputResult {
  if (leaderPending) {
    return { action: leaderCommand(seq), leaderPending: false };
  }
  if (seq === CTRL_B) {
    return { action: { kind: "ignore" }, leaderPending: true };
  }
  if (seq.length > 1 && seq[0] === CTRL_B) {
    // Leader and its command arrived in one buffer (fast typing / paste).
    return classifyInput(seq.slice(1), true);
  }
  return { action: classifyUnprefixed(seq), leaderPending: false };
}
