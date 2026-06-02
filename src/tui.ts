/**
 * The passthrough TUI layer.
 *
 * curtab routes bytes between the real terminal and one PTY per tab. The real
 * terminal is the only live emulator; each Tab keeps a headless shadow emulator
 * purely to repaint its exact screen on switch. A scroll region reserves the
 * bottom row for a status bar. This module is intentionally NOT unit tested — it
 * is raw stdin/stdout wiring. All decision logic lives in ./lib/commands and the
 * sequence builders in ./lib/screen.
 */
import { classifyInput, type InputAction } from "./lib/commands";
import {
  clearScreen,
  paintStatusBar,
  resetScrollRegion,
  setScrollRegion,
} from "./lib/screen";
import { Tab } from "./tab";

export class CurtabApp {
  private tabs: Tab[] = [];
  private active = 0;
  private leaderPending = false;
  private exiting = false;

  constructor(
    private commands: string[],
    private names: string[] = [],
  ) {}

  start(): void {
    const { cols, rows } = this.size();
    this.commands.forEach((command, i) => {
      const tab = new Tab(
        i,
        this.names[i]?.trim() || command,
        command,
        cols,
        rows - 1, // apps run inside the region; the bottom row is curtab's
        {
          onData: (t, data) => this.onTabData(t, data),
          onExit: () => this.paintStatus(),
          onAltScreenChange: (t) => {
            if (t === this.tabs[this.active] && !t.inAltScreen) this.reassert();
          },
        },
      );
      this.tabs.push(tab);
    });

    this.enterRawMode();
    this.write(setScrollRegion(rows));
    this.write("\x1b[H"); // cursor home, inside the region
    this.paintStatus();

    process.stdin.on("data", this.onInput);
    process.stdout.on("resize", this.onResize);
    process.on("SIGTERM", () => this.quit());
    process.on("SIGHUP", () => this.quit());
  }

  private size(): { cols: number; rows: number } {
    return {
      cols: Math.max(1, process.stdout.columns || 80),
      rows: Math.max(2, process.stdout.rows || 24),
    };
  }

  private write(s: string): void {
    process.stdout.write(s);
  }

  private enterRawMode(): void {
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
  }

  /** Active tab's live output is passed straight through to the real terminal. */
  private onTabData(tab: Tab, data: string): void {
    if (tab === this.tabs[this.active] && !this.exiting) this.write(data);
  }

  private paintStatus(): void {
    const { cols, rows } = this.size();
    this.write(paintStatusBar(this.tabs, this.active, rows, cols));
  }

  /** Re-establish the scroll region + status bar (after resize / alt-screen exit). */
  private reassert(): void {
    const { rows } = this.size();
    this.write(setScrollRegion(rows));
    this.paintStatus();
  }

  /** Clear the screen and repaint the active tab's exact state from its shadow. */
  private async repaintActive(): Promise<void> {
    const { rows } = this.size();
    const tab = this.tabs[this.active];
    if (!tab) return;
    this.write(setScrollRegion(rows));
    this.write(clearScreen()); // clear screen + scrollback so tabs don't bleed
    this.write(await tab.snapshot());
    this.paintStatus();
  }

  private async switchTo(index: number): Promise<void> {
    if (index < 0 || index >= this.tabs.length || index === this.active) return;
    this.active = index;
    await this.repaintActive();
  }

  private cycle(delta: number): void {
    const n = this.tabs.length;
    if (n === 0) return;
    void this.switchTo((((this.active + delta) % n) + n) % n);
  }

  private onInput = (data: string): void => {
    if (this.exiting) return;
    const { action, leaderPending } = classifyInput(data, this.leaderPending);
    this.leaderPending = leaderPending;
    this.dispatch(action, data);
  };

  private dispatch(action: InputAction, raw: string): void {
    switch (action.kind) {
      case "quit":
        this.quit();
        return;
      case "restart":
        this.restartActive();
        return;
      case "kill":
        this.killActive();
        return;
      case "switchTab":
        void this.switchTo(action.index);
        return;
      case "cycleTab":
        this.cycle(action.delta);
        return;
      case "ignore":
        return;
      case "forward":
        this.tabs[this.active]?.write(action.data ?? raw);
        return;
    }
  }

  private restartActive(): void {
    const tab = this.tabs[this.active];
    if (!tab) return;
    const { cols, rows } = this.size();
    tab.restart(cols, rows - 1);
    void this.repaintActive();
  }

  private killActive(): void {
    this.tabs[this.active]?.kill();
    this.paintStatus();
  }

  private onResize = (): void => {
    const { cols, rows } = this.size();
    for (const tab of this.tabs) tab.resize(cols, rows - 1);
    void this.repaintActive();
  };

  private quit(): void {
    if (this.exiting) return;
    this.exiting = true;
    this.write(resetScrollRegion());
    this.write("\x1b[?25h"); // show cursor
    for (const tab of this.tabs) tab.dispose();
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(false);
      } catch {
        /* ignore */
      }
    }
    process.exit(0);
  }
}
