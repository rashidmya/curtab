import { describe, expect, it } from "vitest";
import {
  clearScreen,
  paintStatusBar,
  resetScrollRegion,
  setScrollRegion,
  statusBarText,
  teardown,
} from "./screen";

const tabs = [
  { id: 0, name: "web", status: "running" as const },
  { id: 1, name: "api", status: "running" as const },
];

describe("scroll region", () => {
  it("reserves the bottom row (region = rows 1..rows-1)", () => {
    expect(setScrollRegion(24)).toBe("\x1b[1;23r");
  });
  it("never produces a zero-height region", () => {
    expect(setScrollRegion(1)).toBe("\x1b[1;1r");
  });
  it("resets to the full screen", () => {
    expect(resetScrollRegion()).toBe("\x1b[r");
  });
});

describe("clearScreen", () => {
  it("erases the display AND the scrollback, then homes the cursor", () => {
    // \x1b[3J (erase saved lines) is essential: without it the previous tab's
    // scrolled-off output stays in the terminal's shared scrollback and bleeds
    // through when the user scrolls up in the new tab.
    expect(clearScreen()).toBe("\x1b[2J\x1b[3J\x1b[H");
  });
});

describe("teardown", () => {
  it("restores the full region, clears the screen, and shows the cursor", () => {
    // Order matters: reset the region BEFORE clearing so the clear covers the
    // whole screen (including the status row), then show the cursor.
    expect(teardown()).toBe("\x1b[r\x1b[2J\x1b[3J\x1b[H\x1b[?25h");
  });
});

describe("statusBarText", () => {
  it("inverse-marks the active tab", () => {
    expect(statusBarText(tabs, 0, 80)).toBe(
      "\x1b[7m ● 1:web \x1b[0m ● 2:api ",
    );
  });
  it("truncates to the column budget", () => {
    // cols=6 fits only the first label " ● 1:web " sliced to 6 visible chars.
    expect(statusBarText(tabs, 1, 6)).toBe(" ● 1:w");
  });
});

describe("paintStatusBar", () => {
  it("frames the bar with save/move/clear/restore", () => {
    expect(paintStatusBar(tabs, 0, 24, 80)).toBe(
      "\x1b7\x1b[24;1H\x1b[2K\x1b[7m ● 1:web \x1b[0m ● 2:api \x1b8",
    );
  });
});
