/**
 * Pure builders for the terminal control sequences curtab writes directly to
 * stdout. No I/O — every function takes state and returns a string, so the exact
 * bytes can be unit tested.
 */
import { tabLabel, type TabStatus } from "./commands";

export interface BarTab {
  id: number;
  name: string;
  status: TabStatus;
  exitCode?: number;
}

const ESC = "\x1b";
export const SAVE_CURSOR = `${ESC}7`; // DECSC
export const RESTORE_CURSOR = `${ESC}8`; // DECRC

/**
 * DECSTBM: limit the scrolling region to rows 1..(rows-1), reserving the bottom
 * row for the status bar. Apps run inside the region and never touch the bar.
 */
export function setScrollRegion(rows: number): string {
  const bottom = Math.max(1, rows - 1);
  return `${ESC}[1;${bottom}r`;
}

/** Reset the scrolling region to the full screen. */
export function resetScrollRegion(): string {
  return `${ESC}[r`;
}

/**
 * The visible text of the status bar, truncated to `cols`, with the active tab
 * shown in inverse video. SGR codes do not count toward the column budget.
 */
export function statusBarText(tabs: BarTab[], active: number, cols: number): string {
  let out = "";
  let width = 0;
  for (let i = 0; i < tabs.length; i++) {
    const label = ` ${tabLabel(tabs[i])} `;
    if (width + label.length >= cols) {
      const sliced = label.slice(0, Math.max(0, cols - width));
      out += i === active ? `${ESC}[7m${sliced}${ESC}[0m` : sliced;
      return out;
    }
    out += i === active ? `${ESC}[7m${label}${ESC}[0m` : label;
    width += label.length;
  }
  return out;
}

/**
 * Full sequence to paint the status bar on the bottom row without disturbing the
 * app's cursor: save cursor, jump to the bottom row, clear it, write the bar,
 * restore cursor.
 */
export function paintStatusBar(
  tabs: BarTab[],
  active: number,
  rows: number,
  cols: number,
): string {
  return (
    SAVE_CURSOR +
    `${ESC}[${rows};1H` +
    `${ESC}[2K` +
    statusBarText(tabs, active, cols) +
    RESTORE_CURSOR
  );
}
