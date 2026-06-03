/**
 * Pure builders for the control sequences curtab writes to own the screen
 * tmux-style: enter/leave the alternate screen, toggle mouse reporting, reserve
 * the body region (rows 2..N-1), and paint the tab bar (row 1) + key-hint footer
 * (row N). No I/O — every function returns a string so the exact bytes are
 * unit-testable.
 */
import { tabLabel, type TabStatus } from "./commands";

export interface BarTab {
  id: number;
  name: string;
  status: TabStatus;
  exitCode?: number;
}

const ESC = "\x1b";
const SAVE_CURSOR = `${ESC}7`;
const RESTORE_CURSOR = `${ESC}8`;
export const HIDE_CURSOR = `${ESC}[?25l`;
export const SHOW_CURSOR = `${ESC}[?25h`;
const ENTER_ALT = `${ESC}[?1049h`;
const LEAVE_ALT = `${ESC}[?1049l`;
const ENABLE_MOUSE = `${ESC}[?1000h${ESC}[?1006h`;
const DISABLE_MOUSE = `${ESC}[?1006l${ESC}[?1000l`;

/**
 * The footer text — the single source of truth for curtab's key bindings, kept
 * to ≤80 columns so the quit hint survives on a default-width terminal. `^B`/`^C`
 * is standard caret notation for Ctrl+B / Ctrl+C; the README spells them out.
 */
export const FOOTER_HINTS =
  "^B 1-9/n/p tab · r restart · k kill · wheel scroll · Shift-drag copy · ^C quit";

/** DECSTBM: restrict scrolling to rows `top..bottom` (1-based, inclusive). */
export function setScrollRegion(top: number, bottom: number): string {
  const t = Math.max(1, top);
  return `${ESC}[${t};${Math.max(t, bottom)}r`;
}

/** The tab bar for row 1; `marker` shows a ▼ "new output below" hint. */
export function tabBar(
  tabs: BarTab[],
  active: number,
  cols: number,
  marker = false,
): string {
  let out = "";
  let width = 0;
  for (let i = 0; i < tabs.length; i++) {
    const label = ` ${tabLabel(tabs[i])} `;
    if (width + label.length >= cols) {
      const sliced = label.slice(0, Math.max(0, cols - width));
      return out + (i === active ? `${ESC}[7m${sliced}${ESC}[0m` : sliced);
    }
    out += i === active ? `${ESC}[7m${label}${ESC}[0m` : label;
    width += label.length;
  }
  if (marker && width + 2 <= cols) out += " ▼";
  return out;
}

/** Paint the tab bar (row 1) and footer (row N), preserving the app's cursor. */
export function paintBars(
  tabs: BarTab[],
  active: number,
  rows: number,
  cols: number,
  marker = false,
): string {
  const footer =
    FOOTER_HINTS.length > cols ? FOOTER_HINTS.slice(0, cols) : FOOTER_HINTS;
  return (
    SAVE_CURSOR +
    `${ESC}[1;1H${ESC}[2K` +
    tabBar(tabs, active, cols, marker) +
    `${ESC}[${rows};1H${ESC}[2K${ESC}[7m` +
    footer +
    `${ESC}[0m` +
    RESTORE_CURSOR
  );
}

/** Enter curtab's screen: alt buffer, mouse reporting, body region, home body. */
export function setup(rows: number): string {
  return ENTER_ALT + ENABLE_MOUSE + setScrollRegion(2, rows - 1) + `${ESC}[2;1H`;
}

/** Restore the terminal on exit: mouse off, region reset, leave alt, show cursor. */
export function teardown(): string {
  return DISABLE_MOUSE + `${ESC}[r` + LEAVE_ALT + SHOW_CURSOR;
}
