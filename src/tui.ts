/**
 * The interactive TUI + PTY layer.
 *
 * This module is intentionally NOT unit tested: it drives real pseudo-terminals
 * and a full-screen blessed UI. All testable logic lives in ./lib/commands.ts.
 */
import * as blessed from "blessed";
import * as nodePty from "node-pty";
import type { IPty } from "node-pty";
import {
  buildShellInvocation,
  classifyInput,
  tabLabel,
  type TabStatus,
} from "./lib/commands";

export interface ProcessTab {
  id: number;
  name: string;
  command: string;
  pty: IPty;
  widget: any; // blessed.Widgets.TerminalElement (loose typing for term.js interop)
  status: TabStatus;
  exitCode?: number;
  // Scrollback view state. `follow` true = stick to the bottom (live output);
  // false = frozen at `scrollY` (an absolute term.js line offset) so the user
  // can read history while output keeps streaming.
  follow: boolean;
  scrollY: number;
}

const WHEEL_LINES = 3; // lines scrolled per mouse-wheel notch

/**
 * blessed's terminal renderer always draws the *bottom* `rows` lines of the
 * term.js buffer, ignoring the scroll position (`term.ydisp`). We wrap render
 * so that, when the user has scrolled up, the buffer is temporarily sliced to
 * end at the visible window — making blessed draw the scrolled-to region.
 */
function patchScrollbackRender(widget: any): void {
  const origRender = widget.render.bind(widget);
  widget.render = function () {
    const t = widget.term;
    if (t && t.ydisp < t.ybase) {
      const full = t.lines;
      const end = Math.min(full.length, t.ydisp + t.rows);
      t.lines = full.slice(0, end);
      try {
        return origRender();
      } finally {
        t.lines = full;
      }
    }
    return origRender();
  };
}

const FOOTER_TEXT =
  " {bold}Alt+1..9{/bold} tab  " +
  "{bold}Alt+R{/bold} restart  " +
  "{bold}Alt+K{/bold} kill  " +
  "{bold}Wheel/Shift+PgUp{/bold} scroll  " +
  "{bold}Ctrl+C{/bold} quit ";

export class CurtabApp {
  private screen: any;
  private tabBar: any;
  private tabs: ProcessTab[] = [];
  private active = 0;
  private exiting = false;

  constructor(
    private commands: string[],
    private names: string[] = [],
  ) {
    this.screen = blessed.screen({
      smartCSR: true,
      title: "curtab",
      fullUnicode: true,
      // We do our own raw input routing, so don't let blessed grab keys.
      input: process.stdin,
      output: process.stdout,
    });

    this.tabBar = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: "100%",
      height: 1,
      tags: true,
      style: { fg: "white", bg: "black" },
    });

    // Footer is static; it's retained by the screen as a child, so no field.
    blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: "100%",
      height: 1,
      tags: true,
      content: FOOTER_TEXT,
      style: { fg: "white", bg: "blue" },
    });
  }

  start(): void {
    this.commands.forEach((command, index) => this.createTab(command, index));
    this.active = 0;
    this.showActive();
    this.renderTabBar();

    // Keep terminal mouse reporting ON so the scroll wheel and pointer movement
    // are delivered as mouse-report escape sequences (which onInput drops below)
    // rather than being translated by the terminal into arrow-key presses that
    // would leak into the active PTY as junk.
    try {
      this.screen.program.enableMouse();
    } catch {
      /* ignore */
    }

    this.screen.program.input.on("data", this.onInput);
    this.screen.on("resize", this.onResize);

    process.on("SIGTERM", () => this.quit());
    process.on("SIGHUP", () => this.quit());

    this.screen.render();
  }

  private ptySize(): { cols: number; rows: number } {
    // Leave one row for the tab bar (top) and one for the footer (bottom).
    const cols = Math.max(1, (this.screen.width as number) || 80);
    const rows = Math.max(1, ((this.screen.height as number) || 24) - 2);
    return { cols, rows };
  }

  private createTab(command: string, index: number): void {
    const { cols, rows } = this.ptySize();
    const widget = blessed.terminal({
      parent: this.screen,
      top: 1,
      bottom: 1,
      left: 0,
      width: "100%",
      // A no-op handler stops the widget from spawning its own pty.js process,
      // while still enabling full term.js emulation that we feed ourselves.
      handler: () => {},
      cursor: "block",
      hidden: true,
      scrollable: true,
      style: { fg: "default", bg: "default" },
    });

    patchScrollbackRender(widget);

    const pty = this.spawnPty(command, cols, rows);

    const tab: ProcessTab = {
      id: index,
      name: this.names[index]?.trim() || command,
      command,
      pty,
      widget,
      status: "running",
      follow: true,
      scrollY: 0,
    };
    this.tabs.push(tab);
    this.wirePty(tab);
  }

  private spawnPty(command: string, cols: number, rows: number): IPty {
    const { shell, args } = buildShellInvocation(command, {
      platform: process.platform,
      env: process.env,
    });
    return nodePty.spawn(shell, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
    });
  }

  private wirePty(tab: ProcessTab): void {
    // Capture the specific PTY this handler belongs to. After a restart, the
    // old PTY's exit fires asynchronously; without this guard it would clobber
    // the new process's "running" status with "exited".
    const pty = tab.pty;
    pty.onData((data) => {
      if (tab.pty !== pty) return; // stale PTY from before a restart
      const t = tab.widget.term;
      tab.widget.write(data); // term.js snaps ydisp to the bottom on every write
      // If the user has scrolled up, restore the frozen view so streaming
      // output doesn't yank them back to the bottom.
      if (t && !tab.follow) t.ydisp = Math.min(tab.scrollY, t.ybase);
      if (this.tabs[this.active] === tab) this.screen.render();
    });
    pty.onExit(({ exitCode }) => {
      if (tab.pty !== pty) return; // stale PTY from before a restart
      if (tab.status !== "killed") {
        tab.status = "exited";
        tab.exitCode = exitCode;
      }
      this.renderTabBar();
      this.screen.render();
    });
  }

  private showActive(): void {
    this.tabs.forEach((tab, i) => {
      if (i === this.active) tab.widget.show();
      else tab.widget.hide();
    });
    this.tabs[this.active]?.widget.focus();
  }

  private renderTabBar(): void {
    const content = this.tabs
      .map((tab, i) => {
        const label = ` ${tabLabel(tab)} `;
        return i === this.active ? `{inverse}${label}{/inverse}` : label;
      })
      .join("");
    this.tabBar.setContent(content);
  }

  private switchTo(index: number): void {
    if (index < 0 || index >= this.tabs.length || index === this.active) return;
    this.active = index;
    this.showActive();
    this.renderTabBar();
    this.screen.render();
  }

  private restartActive(): void {
    const tab = this.tabs[this.active];
    if (!tab) return;
    try {
      tab.pty.kill();
    } catch {
      /* already dead */
    }
    const { cols, rows } = this.ptySize();
    tab.widget.write("\r\n{curtab} restarting...\r\n");
    tab.pty = this.spawnPty(tab.command, cols, rows);
    tab.status = "running";
    tab.exitCode = undefined;
    tab.follow = true; // jump back to live output on restart
    this.wirePty(tab);
    this.renderTabBar();
    this.screen.render();
  }

  private killActive(): void {
    const tab = this.tabs[this.active];
    if (!tab || tab.status !== "running") return;
    tab.status = "killed";
    try {
      tab.pty.kill();
    } catch {
      /* already dead */
    }
    this.renderTabBar();
    this.screen.render();
  }

  /** Page size (in lines) for keyboard scrolling of the active tab. */
  private pageSize(): number {
    const t = this.tabs[this.active]?.widget.term;
    return Math.max(1, (t?.rows ?? this.ptySize().rows) - 1);
  }

  /** Scroll the active tab's history. delta < 0 scrolls up (into history). */
  private scrollActive(delta: number): void {
    const tab = this.tabs[this.active];
    const t = tab?.widget.term;
    if (!tab || !t) return;
    const from = tab.follow ? t.ybase : tab.scrollY;
    let y = from + delta;
    if (y >= t.ybase) {
      // Reached the bottom — resume following live output.
      tab.follow = true;
      t.ydisp = t.ybase;
    } else {
      if (y < 0) y = 0;
      tab.follow = false;
      tab.scrollY = y;
      t.ydisp = y;
    }
    this.screen.render();
  }

  private onInput = (data: Buffer | string): void => {
    if (this.exiting) return;
    const seq = typeof data === "string" ? data : data.toString("utf8");
    const action = classifyInput(seq);

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
        this.switchTo(action.index);
        return;
      case "scroll": {
        const lines = action.unit === "page" ? this.pageSize() : WHEEL_LINES;
        this.scrollActive(action.direction * lines);
        return;
      }
      case "ignore":
        // A mouse report we deliberately drop so it can't reach the PTY as junk.
        return;
      case "forward": {
        // Everything else goes to the active PTY so the process stays interactive.
        const tab = this.tabs[this.active];
        if (tab && tab.status === "running") tab.pty.write(seq);
        return;
      }
    }
  };

  private onResize = (): void => {
    const { cols, rows } = this.ptySize();
    for (const tab of this.tabs) {
      try {
        tab.pty.resize(cols, rows);
      } catch {
        /* process gone */
      }
    }
    this.screen.render();
  };

  private quit(): void {
    if (this.exiting) return;
    this.exiting = true;
    for (const tab of this.tabs) {
      try {
        tab.pty.kill();
      } catch {
        /* already dead */
      }
    }
    try {
      this.screen.destroy();
    } catch {
      /* ignore */
    }
    process.exit(0);
  }
}
