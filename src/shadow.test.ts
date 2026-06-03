/* eslint-disable no-control-regex -- tests assert on terminal control sequences by design */
import { describe, expect, it } from "vitest";
import { ShadowScreen } from "./shadow";

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("ShadowScreen", () => {
  it("reports scrollback depth as content exceeds the viewport", async () => {
    const s = new ShadowScreen(20, 3);
    expect(s.scrollbackDepth()).toBe(0);
    let d = "";
    for (let i = 0; i < 10; i++) d += `line${i}\r\n`;
    s.feed(d);
    await settle();
    expect(s.scrollbackDepth()).toBeGreaterThan(0);
    s.dispose();
  });

  it("reports the cursor position", async () => {
    const s = new ShadowScreen(20, 3);
    s.feed("ab");
    await settle();
    expect(s.cursor()).toEqual({ x: 2, y: 0 });
    s.dispose();
  });

  it("renders the live viewport with text positioned from rowTop", async () => {
    const s = new ShadowScreen(20, 3);
    s.feed("hello");
    await settle();
    const out = s.renderViewport(0, 3, 20, 2);
    expect(out).toContain("\x1b[2;1H");
    expect(out).toContain("hello");
    s.dispose();
  });
});
