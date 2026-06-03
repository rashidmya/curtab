/* eslint-disable no-control-regex -- tests assert on terminal control sequences by design */
import { describe, expect, it } from "vitest";
import {
  FOOTER_HINTS,
  paintBars,
  setScrollRegion,
  setup,
  tabBar,
  teardown,
} from "./screen";

const tabs = [
  { id: 0, name: "web", status: "running" as const },
  { id: 1, name: "api", status: "running" as const },
];

describe("setScrollRegion", () => {
  it("restricts scrolling to the given inclusive rows", () => {
    expect(setScrollRegion(2, 23)).toBe("\x1b[2;23r");
  });
  it("never produces an inverted region", () => {
    expect(setScrollRegion(2, 1)).toBe("\x1b[2;2r");
  });
});

describe("tabBar", () => {
  it("inverse-marks the active tab", () => {
    expect(tabBar(tabs, 0, 80)).toBe("\x1b[7m ● 1:web \x1b[0m ● 2:api ");
  });
  it("appends a ▼ marker when asked and it fits", () => {
    expect(tabBar(tabs, 0, 80, true)).toContain(" ▼");
  });
  it("truncates to the column budget", () => {
    expect(tabBar(tabs, 1, 6)).toBe(" ● 1:w");
  });
});

describe("setup / teardown", () => {
  it("setup enters alt screen, enables mouse, sets the body region, homes body", () => {
    expect(setup(24)).toBe(
      "\x1b[?1049h\x1b[?1000h\x1b[?1006h\x1b[2;23r\x1b[2;1H",
    );
  });
  it("teardown disables mouse, resets region, leaves alt screen, shows cursor", () => {
    expect(teardown()).toBe("\x1b[?1006l\x1b[?1000l\x1b[r\x1b[?1049l\x1b[?25h");
  });
});

describe("paintBars", () => {
  it("draws the tab bar on row 1 and the footer on row N, preserving the cursor", () => {
    const out = paintBars(tabs, 0, 24, 80);
    expect(out.startsWith("\x1b7")).toBe(true);
    expect(out.endsWith("\x1b8")).toBe(true);
    expect(out).toContain("\x1b[1;1H\x1b[2K");
    expect(out).toContain("\x1b[24;1H\x1b[2K");
    expect(out).toContain(FOOTER_HINTS.slice(0, 10));
  });
});
