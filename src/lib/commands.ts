/* eslint-disable no-control-regex -- input decoding matches terminal control sequences by design */
/**
 * Pure, side-effect-free logic for curtab.
 *
 * Everything here is deliberately decoupled from node-pty and the blessed TUI
 * so it can be unit tested without spawning real processes or a terminal.
 */

export type TabStatus = "running" | "exited" | "killed";

export const USAGE = `curtab — run each command in its own interactive terminal tab.

Usage:
  curtab '<command 1>' '<command 2>' [...]

Each positional argument is ONE full command and is run through your shell.
Commands containing spaces must be quoted (use double quotes on Windows).

Examples:
  curtab 'npm run dev' 'npm run api'
  curtab "npm run dev" "npm run api"   # Windows

Keyboard controls:
  Alt+1..9    switch to tab by index
  Alt+R       restart the active process
  Alt+K       kill the active process
  Ctrl+C      quit curtab and kill all processes

(Terminals cannot transmit Ctrl+<digit>, so curtab uses Alt+<digit>.)
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

/** True when argv requests the version, e.g. `curtab --version` or `curtab -v`. */
export function wantsVersion(argv: string[]): boolean {
  return argv.some((arg) => arg === "--version" || arg === "-v");
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

// --- Keyboard / mouse input decoding -------------------------------------
// Control bytes and escape sequences curtab acts on. Everything else is
// forwarded to the active PTY so the running process stays interactive.
const CTRL_C = "\x03";
const ALT_K = "\x1bk"; // Alt+K — kill (Ctrl+K is readline kill-line)
const ALT_R = "\x1br"; // Alt+R — restart (Ctrl+R is readline reverse-search)
// Shift+PageUp / Shift+PageDown scroll history. Terminals encode the modifier
// differently, so accept all common forms (CSI param 2 = Shift, 3 = Alt; the
// `$` forms are the rxvt encoding). Alt forms are a fallback for terminals that
// reserve Shift+Page for their own scrollback.
const PAGE_UP_KEYS = ["\x1b[5;2~", "\x1b[5$", "\x1b[5;3~"];
const PAGE_DOWN_KEYS = ["\x1b[6;2~", "\x1b[6$", "\x1b[6;3~"];

const SGR_MOUSE = /^\x1b\[<[0-9;]+[mM]/; // ESC [ < n;n;n M/m
const URXVT_MOUSE = /^\x1b\[[0-9;]+M$/; // ESC [ n;n;n M
const SGR_WHEEL_UP = /^\x1b\[<64;/;
const SGR_WHEEL_DOWN = /^\x1b\[<65;/;

/** A decoded user action, or a passthrough/ignore instruction for the TUI. */
export type InputAction =
  | { kind: "quit" }
  | { kind: "restart" }
  | { kind: "kill" }
  | { kind: "switchTab"; index: number } // 0-based tab index
  | { kind: "scroll"; direction: 1 | -1; unit: "page" | "wheel" } // -1 = up
  | { kind: "ignore" } // a mouse report we drop so it can't reach the PTY
  | { kind: "forward" }; // send the raw sequence to the active PTY

/** True for terminal mouse-reporting sequences (X10, SGR, urxvt encodings). */
function isMouseSequence(seq: string): boolean {
  return seq.startsWith("\x1b[M") || SGR_MOUSE.test(seq) || URXVT_MOUSE.test(seq);
}

/** -1 for a wheel-up report, 1 for wheel-down, 0 if not a wheel event. */
function wheelDirection(seq: string): 1 | -1 | 0 {
  if (SGR_WHEEL_UP.test(seq)) return -1;
  if (SGR_WHEEL_DOWN.test(seq)) return 1;
  if (seq.startsWith("\x1b[M") && seq.length >= 4) {
    const button = seq.charCodeAt(3) - 32;
    if (button === 64) return -1; // X10 wheel up
    if (button === 65) return 1; // X10 wheel down
  }
  return 0;
}

/** True for Alt+<1-9> (ESC followed by a single non-zero digit). */
function isAltDigit(seq: string): boolean {
  return (
    seq.length === 2 && seq[0] === "\x1b" && seq[1] >= "1" && seq[1] <= "9"
  );
}

/**
 * Decode one raw input sequence into the action curtab should take. This is the
 * single source of truth for curtab's key bindings; the TUI just dispatches on
 * the result. Precedence matters: shortcuts are matched before anything is
 * forwarded to the PTY.
 */
export function classifyInput(seq: string): InputAction {
  if (seq === CTRL_C) return { kind: "quit" };
  if (seq === ALT_R) return { kind: "restart" };
  if (seq === ALT_K) return { kind: "kill" };
  if (isAltDigit(seq)) return { kind: "switchTab", index: Number(seq[1]) - 1 };
  if (PAGE_UP_KEYS.includes(seq)) {
    return { kind: "scroll", direction: -1, unit: "page" };
  }
  if (PAGE_DOWN_KEYS.includes(seq)) {
    return { kind: "scroll", direction: 1, unit: "page" };
  }

  const wheel = wheelDirection(seq);
  if (wheel !== 0) return { kind: "scroll", direction: wheel, unit: "wheel" };
  if (isMouseSequence(seq)) return { kind: "ignore" };

  return { kind: "forward" };
}
