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
  -h, --help           Show this help and exit.
  -v, --version        Print the curtab version and exit.

Examples:
  curtab 'npm run dev' 'npm run api'
  curtab -n 'web, api' 'npm run dev' 'npm run api'
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

/** The result of parsing curtab's command-line arguments. */
export interface ParsedArgs {
  /** Positional commands, one per tab, in order. */
  commands: string[];
  /** Custom tab names from `-n`/`--names`, matched to commands positionally. */
  names: string[];
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
  let help = false;
  let version = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--version" || arg === "-v") {
      version = true;
    } else if (arg === "--names" || arg === "-n") {
      names = parseNames(argv[++i] ?? ""); // value is the next token
    } else if (arg.startsWith("--names=")) {
      names = parseNames(arg.slice("--names=".length));
    } else if (arg.startsWith("-n=")) {
      names = parseNames(arg.slice("-n=".length));
    } else {
      const command = arg.trim();
      if (command.length > 0) commands.push(command);
    }
  }

  return { commands, names, help, version };
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

/** A decoded user action, or a passthrough instruction for the TUI. */
export type InputAction =
  | { kind: "quit" }
  | { kind: "restart" }
  | { kind: "kill" }
  | { kind: "switchTab"; index: number } // 0-based tab index
  | { kind: "cycleTab"; delta: 1 | -1 } // relative move, wraps in the TUI
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

/**
 * Decode one raw input sequence into the action curtab should take and the next
 * leader state. This is the single source of truth for curtab's key bindings;
 * the TUI just holds `leaderPending` and dispatches on the result.
 *
 * Ctrl+B is a leader: it arms `leaderPending`, and the next event is read as a
 * command. A doubled Ctrl+B forwards a literal Ctrl+B. Ctrl+C quits. Everything
 * else is forwarded so the process stays interactive — the real terminal owns
 * mouse, selection, and scrollback.
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
  if (seq === CTRL_C) return { action: { kind: "quit" }, leaderPending: false };
  return { action: { kind: "forward" }, leaderPending: false };
}
