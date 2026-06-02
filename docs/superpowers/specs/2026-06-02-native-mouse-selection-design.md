# Native mouse text selection in curtab

**Date:** 2026-06-02
**Status:** Approved (design)

## Problem

In the curtab TUI, selecting text with the mouse does not work unless the user
holds **Shift** first, and dragging the mouse upward during a selection
highlights the tab-bar text instead of scrolling into history.

### Root cause

At startup, `tui.ts` calls `this.screen.program.enableMouse()`. On the user's
terminal (gnome-terminal / VTE) this turns on full mouse reporting (DEC modes
`?1000` + `?1002` + `?1003` any-motion + SGR `?1006`), confirmed in
`node_modules/blessed/lib/program.js`. With mouse reporting on:

1. The terminal routes all click/drag events to curtab instead of performing
   native selection. Holding **Shift** is the standard terminal override that
   bypasses the app's mouse grab — hence "selection only works with Shift."
2. curtab is a full-screen *alternate-screen* app that keeps its scrollback in
   its own term.js buffer and only paints the visible window. Native selection
   can only ever highlight what is currently on screen; dragging above the top
   edge highlights the tab bar. Native selection cannot drive curtab's internal
   scroll.

These are two faces of one cause: curtab captures the mouse.

## Decision

Adopt the **"regular terminal feel"** resolution: curtab stops capturing the
mouse. The terminal then owns selection — plain click-drag selects with no
Shift, and the terminal's own `Ctrl+Shift+C` copies it.

Trade-offs explicitly accepted by the user:

- The mouse **wheel** no longer scrolls curtab's history. History is scrolled
  with `Shift+PgUp` / `Shift+PgDn` (already supported).
- "Drag up to extend the selection into history" is **not** provided. Native
  selection can only highlight on-screen text in an alternate-screen app. This
  is a fundamental constraint, not a deferred feature.

Rejected alternatives: an in-app selection engine with its own copy key
(`Alt+C`) — gives drag-into-history but cannot use `Ctrl+Shift+C` because the
terminal intercepts that key before curtab sees it; and a toggle key (tmux
style) — more flexible but adds a mode and a keybinding the user did not want.

## Why the wheel cannot also scroll

The wheel is reported as button-press events (buttons 64/65) under the *same*
tracking mode that reports clicks. There is no "wheel-only" mouse mode.
Capturing the wheel therefore necessarily captures clicks, which re-imposes the
Shift requirement on selection. No-Shift selection and wheel-scroll cannot both
be active at once. In the alternate screen the terminal also has no scrollback
of curtab's output to scroll natively. The wheel is therefore made a no-op.

## Implementation

All changes are confined to `src/tui.ts`. No new modules.

1. **Stop capturing the mouse** — in `start()`, **delete** the
   `this.screen.program.enableMouse()` call (and its surrounding try/catch).
   A fresh terminal defaults to mouse-reporting off, and blessed only enables it
   when a mouse/click/wheel listener is attached (curtab attaches none) or under
   tmux ≥ 2 (`node_modules/blessed/lib/widgets/terminal.js`). The user does not
   run curtab under tmux, so simply removing the call leaves mouse reporting off
   — no explicit `disableMouse()` needed.

2. **Suppress wheel→arrow junk** — in `start()`, call
   `this.screen.program.resetMode('?1007')` (emits `ESC[?1007l`). This is the
   one load-bearing line. In the alternate screen, VTE/gnome-terminal otherwise
   translates the wheel into arrow-key presses (xterm "alternate scroll", mode
   `?1007`) that would flow through `classifyInput` as `forward` and leak into
   the active PTY as junk — the exact problem the original `enableMouse()` call
   was guarding against. Disabling `?1007` makes the wheel an inert no-op.
   Wheel-arrows are byte-identical to real arrow keys, so this cannot be
   filtered in `classifyInput`; `?1007` off is the only clean lever. Terminals
   that do not implement `?1007` ignore the sequence harmlessly. No quit-time
   restore is added — leaving alternate-scroll off for the rest of the terminal
   session is inconsequential (other apps set their own modes).

3. **Footer text** — `FOOTER_TEXT` currently reads
   `{bold}Wheel/Shift+PgUp{/bold} scroll`. Since the wheel no longer scrolls,
   change it to `{bold}Shift+PgUp/PgDn{/bold} scroll`. No copy key is advertised
   (it varies by terminal and OS).

4. **Remove the dead wheel-scroll path** — capturing the wheel is gone for good,
   so the code that turned wheel reports into scroll actions is now dead. Remove
   it for honesty, keeping the mouse-byte safety net:
   - In `src/lib/commands.ts`: delete `wheelDirection()`, `SGR_WHEEL_UP`,
     `SGR_WHEEL_DOWN`, and the `const wheel = wheelDirection(seq); if (wheel …)`
     branch in `classifyInput`. Narrow the `InputAction` `scroll` member's
     `unit` from `"page" | "wheel"` to `"page"`.
   - **Keep** `isMouseSequence()` and the `{ kind: "ignore" }` branch. Its
     `SGR_MOUSE` regex already matches wheel sequences, so it remains the single
     catch-all that drops any stray mouse bytes (so they can't leak into the PTY)
     should mouse reporting ever be on.
   - In `src/tui.ts`: delete the `WHEEL_LINES` constant and collapse the
     `action.unit === "page" ? this.pageSize() : WHEEL_LINES` expression in the
     `"scroll"` case to `this.pageSize()`.
   - In `src/lib/commands.test.ts`: remove the two wheel-scroll test cases; the
     `{ kind: "ignore" }` cases stay.

### Left unchanged

- `isMouseSequence()` → `{ kind: "ignore" }` in `classifyInput` (the mouse-byte
  drop), the page-scroll path, keyboard scrolling (`Shift+PgUp` / `Shift+PgDn`),
  and the custom scrollback renderer (`patchScrollbackRender`, `term.ydisp`).

## Testing

`tui.ts` is intentionally not unit-tested (it drives a real PTY and a
full-screen blessed UI). Verification is manual, in a real terminal:

1. Click-drag over output → text is selected **without** holding Shift.
2. `Ctrl+Shift+C` → selected text lands on the system clipboard.
3. Spin the mouse wheel → nothing scrolls **and** no stray characters reach the
   shell in the active tab.
4. `Shift+PgUp` / `Shift+PgDn` → history still scrolls.
5. `classifyInput` unit tests pass after the wheel-scroll cases are removed
   (the `{ kind: "ignore" }` cases still pass, proving stray mouse bytes are
   still dropped).

## Known caveats

- Under tmux ≥ 2, blessed auto-enables the mouse during terminal-widget
  construction, so this change would not fully take effect there. The user does
  not run curtab under tmux, so this is out of scope; if tmux support is wanted
  later, add an explicit `this.screen.program.disableMouse()` after the
  `createTab` loop.
