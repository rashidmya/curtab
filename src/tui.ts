/**
 * The curtab TUI. curtab owns the screen tmux-style: it enters the alternate
 * screen, pins the tab bar (row 1) and key-hint footer (row N), and renders the
 * active tab from its shadow emulator into rows 2..N-1. One render path serves
 * both the live view (scroll offset 0) and scrolled-back history. Raw I/O — not
 * unit tested; decision logic lives in ./lib/commands and the sequence builders
 * in ./lib/screen.
 */
import { classifyInput, type InputAction } from "./lib/commands";
import {
  HIDE_CURSOR,
  SHOW_CURSOR,
  paintBars,
  setScrollRegion,
  setup,
  teardown,
} from "./lib/screen";
import { Tab } from "./tab";

const WHEEL_LINES = 3; // lines per wheel notch
const FRAME_MS = 16; // coalesce output bursts to ~60fps
const RESERVED_ROWS = 2; // tab bar (row 1) + key-hint footer (row N)

export class CurtabApp {
  private tabs: Tab[] = [];
  private active = 0;
  private offset = 0; // lines scrolled above the live bottom (0 = live)
  private leaderPending = false;
  private exiting = false;
  private renderScheduled = false;
  private unseen = false; // new output arrived while scrolled

  constructor(
    private commands: string[],
    private names: string[] = [],
    private color = false, // tint tab status; opt in with -c
  ) {}

  start(): void {
    const { cols, rows } = this.size();
    this.commands.forEach((command, i) => {
      const tab = new Tab(i, this.names[i]?.trim() || command, command, cols, rows - RESERVED_ROWS, {
        onData: (t) => this.onTabData(t),
        onExit: () => this.scheduleRender(),
      });
      this.tabs.push(tab);
    });

    this.enterRawMode();
    this.write(setup(rows));
    this.render();

    process.stdin.on("data", this.onInput);
    process.stdout.on("resize", this.onResize);
    process.on("SIGTERM", () => this.quit());
    process.on("SIGHUP", () => this.quit());
  }

  private size(): { cols: number; rows: number } {
    return {
      cols: Math.max(1, process.stdout.columns || 80),
      rows: Math.max(3, process.stdout.rows || 24),
    };
  }

  private bodyHeight(): number {
    return Math.max(1, this.size().rows - RESERVED_ROWS);
  }

  private write(s: string): void {
    process.stdout.write(s);
  }

  private enterRawMode(): void {
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
  }

  private onTabData(tab: Tab): void {
    if (tab !== this.tabs[this.active]) return; // inactive tabs just accumulate
    if (this.offset > 0) this.unseen = true; // frozen view; flag fresh output
    this.scheduleRender();
  }

  /** Coalesce output bursts into one repaint. */
  private scheduleRender(): void {
    if (this.renderScheduled || this.exiting) return;
    this.renderScheduled = true;
    setTimeout(() => {
      this.renderScheduled = false;
      this.render();
    }, FRAME_MS);
  }

  private render(): void {
    if (this.exiting) return;
    const tab = this.tabs[this.active];
    if (!tab) return;
    const { cols, rows } = this.size();
    const height = rows - RESERVED_ROWS;
    const max = tab.scrollbackDepth();
    if (this.offset > max) this.offset = max;

    let out = tab.renderViewport(this.offset, height, cols, 2);
    out += paintBars(
      this.tabs,
      this.active,
      rows,
      cols,
      this.offset > 0 && this.unseen,
      this.leaderPending,
      this.color,
    );
    if (this.offset === 0) {
      const c = tab.cursor();
      out += `\x1b[${2 + Math.min(height - 1, c.y)};${1 + c.x}H` + SHOW_CURSOR;
    } else {
      out += HIDE_CURSOR;
    }
    this.write(out);
  }

  private onInput = (data: string): void => {
    if (this.exiting) return;
    const wasLeader = this.leaderPending;
    const { action, leaderPending } = classifyInput(data, this.leaderPending);
    this.leaderPending = leaderPending;
    this.dispatch(action, data);
    // The arming case dispatches "ignore" (no render); repaint when the leader flips.
    if (this.leaderPending !== wasLeader) this.render();
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
        this.switchTo(action.index);
        return;
      case "cycleTab":
        this.cycle(action.delta);
        return;
      case "scroll":
        this.scroll(action.direction, action.unit);
        return;
      case "ignore":
        return;
      case "forward":
        this.tabs[this.active]?.write(action.data ?? raw);
        return;
    }
  }

  private scroll(direction: 1 | -1, unit: "line" | "page"): void {
    const tab = this.tabs[this.active];
    if (!tab) return;
    const amount = unit === "page" ? Math.max(1, this.bodyHeight() - 1) : WHEEL_LINES;
    const max = tab.scrollbackDepth();
    let next = this.offset - direction * amount; // up (-1) increases offset
    if (next < 0) next = 0;
    if (next > max) next = max;
    if (next === this.offset) return;
    this.offset = next;
    if (this.offset === 0) this.unseen = false;
    this.render();
  }

  private switchTo(index: number): void {
    if (index < 0 || index >= this.tabs.length || index === this.active) return;
    this.active = index;
    this.offset = 0;
    this.unseen = false;
    this.render();
  }

  private cycle(delta: number): void {
    const n = this.tabs.length;
    if (n === 0) return;
    this.switchTo((((this.active + delta) % n) + n) % n);
  }

  private restartActive(): void {
    const tab = this.tabs[this.active];
    if (!tab) return;
    const { cols, rows } = this.size();
    tab.restart(cols, rows - RESERVED_ROWS);
    this.offset = 0;
    this.unseen = false;
    this.render();
  }

  private killActive(): void {
    this.tabs[this.active]?.kill();
    this.render();
  }

  private onResize = (): void => {
    const { cols, rows } = this.size();
    const height = rows - RESERVED_ROWS;
    this.write(setScrollRegion(2, rows - 1));
    for (const tab of this.tabs) tab.resize(cols, height);
    this.render();
  };

  private quit(): void {
    if (this.exiting) return;
    this.exiting = true;
    this.write(teardown());
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
