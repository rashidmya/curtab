/**
 * A headless terminal emulator shadowing one tab. curtab feeds it the tab's PTY
 * output and renders its grid to the real screen (the tab's authoritative
 * screen + scrollback live here). The real terminal never sees the app's bytes,
 * which is what lets curtab pin its own bars.
 */
import { Terminal } from "@xterm/headless";
import { renderWindow } from "./lib/render";

const SCROLLBACK = 5000;

export class ShadowScreen {
  private term: Terminal;

  constructor(cols: number, rows: number) {
    this.term = new Terminal({
      cols: Math.max(1, cols),
      rows: Math.max(1, rows),
      scrollback: SCROLLBACK,
      allowProposedApi: true,
    });
  }

  /** Feed raw PTY output into the emulator. */
  feed(data: string): void {
    this.term.write(data);
  }

  /** Resize the emulator to the body region. */
  resize(cols: number, rows: number): void {
    this.term.resize(Math.max(1, cols), Math.max(1, rows));
  }

  /** Lines scrolled above the viewport — the maximum scroll offset. */
  scrollbackDepth(): number {
    return this.term.buffer.active.baseY;
  }

  /** Cursor position relative to the viewport top. */
  cursor(): { x: number; y: number } {
    const b = this.term.buffer.active;
    return { x: b.cursorX, y: b.cursorY };
  }

  /**
   * Render `height` rows at scroll `offset` (0 = live bottom) into real-screen
   * rows starting at `rowTop`.
   */
  renderViewport(offset: number, height: number, cols: number, rowTop: number): string {
    const b = this.term.buffer.active;
    return renderWindow(b, b.baseY - offset, height, cols, rowTop);
  }

  dispose(): void {
    this.term.dispose();
  }
}
