/* eslint-disable no-control-regex -- alt-screen detection matches terminal control sequences by design */
/**
 * One curtab tab: a node-pty process plus a headless ShadowScreen that mirrors
 * its output for repaint-on-switch. The Tab tracks run status and whether the
 * app is on the alternate screen (so the TUI can re-assert its status bar when a
 * full-screen app exits).
 */
import * as nodePty from "node-pty";
import type { IPty } from "node-pty";
import { buildShellInvocation, type TabStatus } from "./lib/commands";
import { ShadowScreen } from "./shadow";

const ALT_SCREEN_ENTER = /\x1b\[\?(?:1049|1047|47)h/;
const ALT_SCREEN_EXIT = /\x1b\[\?(?:1049|1047|47)l/;

export interface TabHooks {
  /** Called with raw PTY output; the TUI passes it through to stdout if active. */
  onData: (tab: Tab, data: string) => void;
  /** Called when the PTY exits. */
  onExit: (tab: Tab) => void;
  /** Called when the app enters or leaves the alternate screen. */
  onAltScreenChange: (tab: Tab) => void;
}

export class Tab {
  readonly id: number;
  name: string;
  readonly command: string;
  status: TabStatus = "running";
  exitCode?: number;
  inAltScreen = false;

  private pty: IPty;
  private shadow: ShadowScreen;

  constructor(
    id: number,
    name: string,
    command: string,
    cols: number,
    rows: number,
    private hooks: TabHooks,
  ) {
    this.id = id;
    this.name = name;
    this.command = command;
    this.shadow = new ShadowScreen(cols, rows);
    this.pty = this.spawn(cols, rows);
  }

  private spawn(cols: number, rows: number): IPty {
    const { shell, args } = buildShellInvocation(this.command, {
      platform: process.platform,
      env: process.env,
    });
    const pty = nodePty.spawn(shell, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
    });
    pty.onData((data) => {
      if (this.pty !== pty) return; // stale PTY from before a restart
      this.shadow.feed(data);
      this.trackAltScreen(data);
      this.hooks.onData(this, data);
    });
    pty.onExit(({ exitCode }) => {
      if (this.pty !== pty) return; // stale PTY from before a restart
      if (this.status !== "killed") {
        this.status = "exited";
        this.exitCode = exitCode;
      }
      this.hooks.onExit(this);
    });
    return pty;
  }

  private trackAltScreen(data: string): void {
    let changed = false;
    if (!this.inAltScreen && ALT_SCREEN_ENTER.test(data)) {
      this.inAltScreen = true;
      changed = true;
    }
    if (this.inAltScreen && ALT_SCREEN_EXIT.test(data)) {
      this.inAltScreen = false;
      changed = true;
    }
    if (changed) this.hooks.onAltScreenChange(this);
  }

  /** Forward user input to the process (only while it is running). */
  write(data: string): void {
    if (this.status === "running") this.pty.write(data);
  }

  /** Resize both the PTY and the shadow emulator to the usable region. */
  resize(cols: number, rows: number): void {
    this.shadow.resize(cols, rows);
    try {
      this.pty.resize(cols, rows);
    } catch {
      /* process gone */
    }
  }

  /** Exact screen + scrollback for repaint on switch. */
  snapshot(): Promise<string> {
    return this.shadow.snapshot();
  }

  /** Kill the old process, start a fresh one, and reset the shadow. */
  restart(cols: number, rows: number): void {
    try {
      this.pty.kill();
    } catch {
      /* already dead */
    }
    this.shadow.dispose();
    this.shadow = new ShadowScreen(cols, rows);
    this.status = "running";
    this.exitCode = undefined;
    this.inAltScreen = false;
    this.pty = this.spawn(cols, rows);
  }

  /** Send SIGTERM and mark the tab killed. */
  kill(): void {
    if (this.status !== "running") return;
    this.status = "killed";
    try {
      this.pty.kill();
    } catch {
      /* already dead */
    }
  }

  dispose(): void {
    try {
      this.pty.kill();
    } catch {
      /* already dead */
    }
    this.shadow.dispose();
  }
}
