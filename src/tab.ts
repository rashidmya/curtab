/**
 * One curtab tab: a node-pty process plus a headless ShadowScreen that mirrors
 * its output. curtab renders the active tab from the shadow; the Tab tracks run
 * status and exposes the shadow's scroll/cursor/render to the TUI.
 */
import * as nodePty from "node-pty";
import type { IPty } from "node-pty";
import { buildShellInvocation, type TabStatus } from "./lib/commands";
import { ShadowScreen } from "./shadow";

export interface TabHooks {
  /** Called when the active tab should be repainted (new output). */
  onData: (tab: Tab) => void;
  /** Called when the PTY exits. */
  onExit: (tab: Tab) => void;
}

export class Tab {
  readonly id: number;
  name: string;
  readonly command: string;
  status: TabStatus = "running";
  exitCode?: number;

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
      this.hooks.onData(this);
    });
    pty.onExit(({ exitCode }) => {
      if (this.pty !== pty) return;
      if (this.status !== "killed") {
        this.status = "exited";
        this.exitCode = exitCode;
      }
      this.hooks.onExit(this);
    });
    return pty;
  }

  /** Forward user input to the process (only while running). */
  write(data: string): void {
    if (this.status === "running") this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    this.shadow.resize(cols, rows);
    try {
      this.pty.resize(cols, rows);
    } catch {
      /* process gone */
    }
  }

  scrollbackDepth(): number {
    return this.shadow.scrollbackDepth();
  }

  cursor(): { x: number; y: number } {
    return this.shadow.cursor();
  }

  renderViewport(offset: number, height: number, cols: number, rowTop: number): string {
    return this.shadow.renderViewport(offset, height, cols, rowTop);
  }

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
    this.pty = this.spawn(cols, rows);
  }

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
