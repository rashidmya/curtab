/**
 * A headless terminal emulator that shadows one tab. curtab feeds it the tab's
 * PTY output so it always holds the tab's exact screen + scrollback; on switch
 * the TUI replays `snapshot()` to repaint that tab precisely. This is the only
 * emulator curtab keeps — the live screen is the user's real terminal.
 */
import { Terminal } from "@xterm/headless";
import { SerializeAddon } from "@xterm/addon-serialize";

const SCROLLBACK = 5000;

export class ShadowScreen {
  private term: Terminal;
  private serializer: SerializeAddon;

  constructor(cols: number, rows: number) {
    this.term = new Terminal({
      cols: Math.max(1, cols),
      rows: Math.max(1, rows),
      scrollback: SCROLLBACK,
      allowProposedApi: true,
    });
    this.serializer = new SerializeAddon();
    this.term.loadAddon(this.serializer);
  }

  /** Feed raw PTY output into the emulator. */
  feed(data: string): void {
    this.term.write(data);
  }

  /** Resize the emulator to match the usable screen region. */
  resize(cols: number, rows: number): void {
    this.term.resize(Math.max(1, cols), Math.max(1, rows));
  }

  /**
   * Reconstruct the current screen + scrollback as an escape-sequence string.
   * Writes are async in xterm, so flush the queue (a trailing empty write whose
   * callback fires after all prior writes are parsed) before serializing.
   */
  async snapshot(): Promise<string> {
    await new Promise<void>((resolve) => this.term.write("", resolve));
    return this.serializer.serialize({ scrollback: SCROLLBACK });
  }

  dispose(): void {
    this.term.dispose();
  }
}
