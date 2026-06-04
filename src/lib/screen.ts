/**
 * Pure builders for the control sequences curtab writes to own the screen
 * tmux-style: enter/leave the alternate screen, toggle mouse reporting, reserve
 * the body region (rows 2..N-1), and paint the tab bar (row 1) + key-hint footer
 * (row N). No I/O — every function returns a string so the exact bytes are
 * unit-testable.
 */
import { statusColor, tabLabel, type TabStatus } from "./commands";

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

/** Resting footer: a quiet hint that `^B` opens the command menu. */
export const FOOTER_HINTS = "^B for commands";

/** Which-key cheat sheet shown while the `^B` leader is armed; kept ≤80 cols. */
export const LEADER_HINTS =
  "^B 1-9 switch · n/p cycle · r restart · k kill · ^B literal";

/** DECSTBM: restrict scrolling to rows `top..bottom` (1-based, inclusive). */
export function setScrollRegion(top: number, bottom: number): string {
  const t = Math.max(1, top);
  return `${ESC}[${t};${Math.max(t, bottom)}r`;
}

/**
 * Style one ` <glyph> <n>:<name> ` tab segment from its precomputed `plain`
 * label. Without color the active tab is a reversed block and the rest are plain
 * (the legacy look); with color the status glyph is tinted and the active tab's
 * name is reversed, so a crashed background tab still stands out.
 */
function renderTab(
  tab: BarTab,
  plain: string,
  isActive: boolean,
  color: boolean,
): string {
  if (!color) {
    return isActive ? `${ESC}[7m ${plain} ${ESC}[0m` : ` ${plain} `;
  }
  const glyph = plain.slice(0, 1);
  const rest = plain.slice(1); // includes the leading space before the name
  const c = statusColor(tab.status, tab.exitCode);
  if (isActive) {
    return ` ${ESC}[${c};1m${glyph}${ESC}[0m${ESC}[7m${rest} ${ESC}[0m`;
  }
  return ` ${ESC}[${c}m${glyph}${ESC}[0m${rest} `;
}

/**
 * The tab bar for row 1; `marker` adds a ▼ "new output below" hint and `color`
 * tints status (off unless -c). Width is measured on the visible label so
 * zero-width SGR codes never skew truncation.
 */
export function tabBar(
  tabs: BarTab[],
  active: number,
  cols: number,
  marker = false,
  color = false,
): string {
  let out = "";
  let width = 0;
  for (let i = 0; i < tabs.length; i++) {
    const plain = tabLabel(tabs[i]);
    const segWidth = plain.length + 2; // the surrounding spaces
    if (width + segWidth >= cols) {
      const sliced = ` ${plain} `.slice(0, Math.max(0, cols - width));
      return out + (i === active ? `${ESC}[7m${sliced}${ESC}[0m` : sliced);
    }
    out += renderTab(tabs[i], plain, i === active, color);
    width += segWidth;
  }
  if (marker && width + 2 <= cols) out += " ▼";
  return out;
}

/**
 * The footer for row N, clipped to `cols`: reverse-video which-key hints while
 * the leader is armed, otherwise the resting hint dimmed. Dim is a brightness
 * attribute, not color, so it's independent of -c.
 */
export function footerLine(cols: number, leaderPending = false): string {
  const text = leaderPending ? LEADER_HINTS : FOOTER_HINTS;
  const sgr = leaderPending ? 7 : 2; // reverse (armed) vs dim (resting)
  return `${ESC}[${sgr}m${text.slice(0, cols)}${ESC}[0m`;
}

/** Paint the tab bar (row 1) and footer (row N), preserving the app's cursor. */
export function paintBars(
  tabs: BarTab[],
  active: number,
  rows: number,
  cols: number,
  marker = false,
  leaderPending = false,
  color = false,
): string {
  return (
    SAVE_CURSOR +
    `${ESC}[1;1H${ESC}[2K` +
    tabBar(tabs, active, cols, marker, color) +
    `${ESC}[${rows};1H${ESC}[2K` +
    footerLine(cols, leaderPending) +
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
