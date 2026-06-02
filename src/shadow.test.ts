/* eslint-disable no-control-regex -- tests assert on terminal control sequences by design */
import { describe, expect, it } from "vitest";
import { ShadowScreen } from "./shadow";

describe("ShadowScreen", () => {
  it("round-trips plain text through serialize", async () => {
    const s = new ShadowScreen(80, 24);
    s.feed("hello world");
    const snap = await s.snapshot();
    expect(snap).toContain("hello world");
    s.dispose();
  });

  it("preserves color SGR in the snapshot", async () => {
    const s = new ShadowScreen(80, 24);
    s.feed("\x1b[31mred\x1b[0m");
    const snap = await s.snapshot();
    expect(snap).toContain("red");
    expect(snap).toMatch(/\x1b\[[0-9;]*31[0-9;]*m/); // a red foreground SGR
    s.dispose();
  });

  it("resizes without throwing", async () => {
    const s = new ShadowScreen(80, 24);
    s.feed("line");
    s.resize(100, 30);
    expect(await s.snapshot()).toContain("line");
    s.dispose();
  });
});
