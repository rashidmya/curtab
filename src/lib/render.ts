/**
 * Turn a slice of an @xterm/headless buffer back into ANSI. curtab renders the
 * active tab by reading the emulator grid and re-emitting each line at a chosen
 * real-screen row, so the app's own coordinates never reach the terminal (which
 * is what lets us pin a tab bar above the content).
 */
import type { IBuffer, IBufferCell, IBufferLine } from "@xterm/headless";

const ESC = "\x1b";

/** SGR parameter list for one cell's style, always led by a reset (`0`). */
function styleParams(cell: IBufferCell): string {
  const p: number[] = [0];
  if (cell.isBold()) p.push(1);
  if (cell.isDim()) p.push(2);
  if (cell.isItalic()) p.push(3);
  if (cell.isUnderline()) p.push(4);
  if (cell.isInverse()) p.push(7);
  if (cell.isStrikethrough()) p.push(9);
  if (cell.isFgRGB()) {
    const c = cell.getFgColor();
    p.push(38, 2, (c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff);
  } else if (cell.isFgPalette()) {
    p.push(38, 5, cell.getFgColor());
  }
  if (cell.isBgRGB()) {
    const c = cell.getBgColor();
    p.push(48, 2, (c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff);
  } else if (cell.isBgPalette()) {
    p.push(48, 5, cell.getBgColor());
  }
  return p.join(";");
}

/** Render one buffer line to styled ANSI text (no positioning), `cols` wide. */
function renderLine(line: IBufferLine, cols: number): string {
  let out = "";
  let lastSig = "";
  for (let x = 0; x < cols; x++) {
    const cell = line.getCell(x);
    if (!cell) break;
    if (cell.getWidth() === 0) continue; // second half of a wide glyph
    const sig = styleParams(cell);
    if (sig !== lastSig) {
      out += `${ESC}[${sig}m`;
      lastSig = sig;
    }
    out += cell.getChars() || " ";
  }
  return out + `${ESC}[0m`;
}

/**
 * Render `height` lines starting at absolute buffer line `top`, drawing each at
 * real-screen row `rowTop + i` (cleared first). Lines past the buffer end render
 * as a cleared blank row.
 */
export function renderWindow(
  buffer: IBuffer,
  top: number,
  height: number,
  cols: number,
  rowTop: number,
): string {
  let out = "";
  for (let i = 0; i < height; i++) {
    out += `${ESC}[${rowTop + i};1H${ESC}[2K`;
    const idx = top + i;
    const line = idx >= 0 ? buffer.getLine(idx) : undefined;
    if (line) out += renderLine(line, cols);
  }
  return out;
}
