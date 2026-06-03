/* eslint-disable no-control-regex -- tests assert on terminal control sequences by design */
import { describe, expect, it } from "vitest";
import { Terminal } from "@xterm/headless";
import { renderWindow } from "./render";

const flush = (t: Terminal) => new Promise<void>((r) => t.write("", r));

describe("renderWindow", () => {
  it("draws each buffer line at rowTop + i and clears the row first", async () => {
    const t = new Terminal({ cols: 10, rows: 3, allowProposedApi: true });
    t.write("abc\r\ndef");
    await flush(t);
    const out = renderWindow(t.buffer.active, 0, 2, 10, 2);
    expect(out).toContain("\x1b[2;1H\x1b[2K");
    expect(out).toContain("abc");
    expect(out).toContain("\x1b[3;1H\x1b[2K");
    expect(out).toContain("def");
    t.dispose();
  });

  it("reconstructs palette color as 38;5;n", async () => {
    const t = new Terminal({ cols: 10, rows: 2, allowProposedApi: true });
    t.write("\x1b[31mred\x1b[0m");
    await flush(t);
    const out = renderWindow(t.buffer.active, 0, 1, 10, 2);
    expect(out).toContain("red");
    expect(out).toMatch(/38;5;1/);
    t.dispose();
  });

  it("reconstructs truecolor as 38;2;r;g;b and bold as 1", async () => {
    const t = new Terminal({ cols: 12, rows: 2, allowProposedApi: true });
    t.write("\x1b[1;38;2;10;20;30mhi\x1b[0m");
    await flush(t);
    const out = renderWindow(t.buffer.active, 0, 1, 12, 2);
    expect(out).toContain("hi");
    expect(out).toMatch(/38;2;10;20;30/);
    expect(out).toMatch(/\x1b\[0;1[;m]/);
    t.dispose();
  });

  it("renders blank for lines past the buffer end", async () => {
    const t = new Terminal({ cols: 5, rows: 2, allowProposedApi: true });
    t.write("x");
    await flush(t);
    const out = renderWindow(t.buffer.active, 0, 2, 5, 2);
    expect(out).toContain("\x1b[2;1H");
    expect(out).toContain("\x1b[3;1H");
    t.dispose();
  });
});
