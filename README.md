# curtab

Run multiple commands at once — each in its own **interactive terminal tab**.

Instead of interleaving every process's output into a single stream, `curtab`
gives each command its own tab in a full-screen terminal UI. Each process runs
in a real pseudo-terminal (PTY), so programs stay **fully interactive** —
prompts, colors, progress bars, and keyboard input all work.

```
curtab 'npm run dev' 'npm run api'
```

```
 ● 1:npm run dev   ✓ 2:npm run api
┌──────────────────────────────────────────────┐
│ (active tab's live terminal output, in color) │
│                                                │
└──────────────────────────────────────────────┘
 Alt+1..9 tab  Alt+R restart  Alt+K kill  Wheel/Shift+PgUp scroll  Ctrl+C quit
```

## Installation

Install globally with your favorite package manager:

```bash
npm install -g curtab
pnpm add -g curtab
yarn global add curtab
```

After installing, the `curtab` command is available everywhere.

## Usage

Each positional argument is **one full command**:

```bash
curtab 'command1 arg' 'command2 arg'
```

On Windows (use double quotes):

```bash
curtab "command1 arg" "command2 arg"
```

Example — start a dev server and an API together, each in its own tab:

```bash
curtab 'npm run dev' 'npm run api'
```

If you run `curtab` with no commands, it prints usage and exits.

## Quoting rules (important)

`curtab` reads its arguments straight from `process.argv` and treats **each
argument as a complete command**. It never splits a command on spaces and never
re-joins arguments. This means quoting matters:

```bash
# ✅ two commands
curtab 'npm run dev' 'npm run api'

# ❌ SIX commands — the shell passes each word separately, so curtab sees
#    "npm", "run", "dev", "npm", "run", "api" as six independent commands
curtab npm run dev npm run api
```

> **Commands with spaces must be quoted. Windows only supports double quotes in
> most shells. In package.json, quotes must be escaped:**
>
> ```json
> {
>   "scripts": {
>     "dev": "curtab \"npm run dev\" \"npm run api\""
>   }
> }
> ```

### Windows notes

- Use **double quotes** (`"..."`), not single quotes — most Windows shells
  (`cmd.exe`, PowerShell) do not treat single quotes the way POSIX shells do.
- Commands run through `cmd.exe /d /s /c "<command>"`.
- Terminal emulation works best in **Windows Terminal**.

### package.json script examples

```json
{
  "scripts": {
    "dev": "curtab \"npm run web\" \"npm run api\"",
    "stack": "curtab \"docker compose up\" \"npm run dev\" \"npm run worker\""
  }
}
```

## Keyboard controls

| Key | Action |
| --- | --- |
| `Alt`+`1`..`9` | Switch to tab by index |
| `Alt`+`R` | Restart the active process |
| `Alt`+`K` | Kill the active process |
| Mouse wheel / `Shift`+`PageUp` / `Shift`+`PageDown` | Scroll the active tab's history |
| `Ctrl`+`C` | Quit `curtab` and kill all running processes |

These controls are shown in the footer at the bottom of the screen.

> **Why `Alt`+digit and not `Ctrl`+digit?** Most terminals physically cannot
> transmit `Ctrl`+`<digit>` as a distinct key (for example `Ctrl`+`3` is
> indistinguishable from `Esc`). `curtab` therefore uses `Alt`+`<digit>` for
> reliable, cross-platform tab switching.

### Tab status indicators

| Icon | Meaning |
| --- | --- |
| `●` | running |
| `✓` | exited successfully (exit code 0) |
| `✕` | exited with a non-zero code |
| `■` | killed |

Inactive tabs keep running and buffering their output (with scrollback), so
nothing is lost while you're looking at another tab.

## Local development

```bash
npm install
npm run build
node dist/index.js 'npm run dev' 'npm run api'
```

Run without building, using `ts-node`:

```bash
npm run dev   # ts-node src/index.ts (pass commands after --)
```

### Test it as a global command locally

```bash
npm link
curtab 'npm run dev' 'npm run api'
```

### Scripts

| Script | Description |
| --- | --- |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dev` | Run the CLI from source via `ts-node` |
| `npm run lint` | Lint with ESLint |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Run the unit tests (Vitest) |

## How it works

- Commands are read from `process.argv.slice(2)`; each argument is one command.
- Each command is spawned through the user's shell using
  [`node-pty`](https://github.com/microsoft/node-pty):
  - Unix: `process.env.SHELL || "bash"` with `["-lc", command]`
  - Windows: `cmd.exe` with `["/d", "/s", "/c", command]`
- The UI is built with [`blessed`](https://github.com/chjj/blessed); each tab is a
  terminal widget backed by a `term.js` emulator that we feed from its PTY, so
  ANSI colors and full-screen programs render correctly.
- Only the active tab receives keyboard input; the rest keep running.
- On resize, the PTYs are resized to match the available area.
- On exit, all child processes are killed and the screen is restored.

The pure logic (argument parsing, shell-command generation, status icons) lives
in `src/lib/commands.ts` and is unit tested. The interactive PTY/TUI layer lives
in `src/tui.ts`.

## Releasing / publishing

Releasing is automated by GitHub Actions and is driven by pushing a version
tag (`v*`). To cut a release:

1. Update the `version` in `package.json` (e.g. `0.1.0`).
2. Commit the change.
3. Create a git tag matching the version:
   ```bash
   git tag v0.1.0
   ```
4. Push the tag:
   ```bash
   git push origin v0.1.0
   ```
5. GitHub Actions then builds, tests, **publishes the package to npm** using the
   `NPM_TOKEN` repository secret (with [npm provenance](https://docs.npmjs.com/generating-provenance-statements)),
   and **creates a GitHub Release** for the tag with auto-generated notes and the
   source-code archives GitHub attaches automatically.

Set `NPM_TOKEN` under **Settings → Secrets and variables → Actions** in your
GitHub repository. No secrets are hardcoded.

The published package only includes `dist/`, `README.md`, `LICENSE`, and
`package.json` (via the `files` field).

## Known limitations

- **`Ctrl`+`<digit>`** is not deliverable by most terminals; use `Alt`+`<digit>`.
- The `Alt`-based shortcuts (`Alt`+digit, `Alt`+`R`, `Alt`+`K`) are captured by
  `curtab`, so the active process cannot receive those specific `Alt` chords
  while a tab is focused. They were chosen to avoid clobbering common shell
  control keys such as `Ctrl`+`R` (reverse-search) and `Ctrl`+`K` (kill-line).
- Full-screen / cursor-addressing apps (e.g. `vim`, `htop`) render through the
  `term.js` emulator; most things work, but exotic escape sequences may not be
  perfectly emulated.
- This is an MVP: no named tabs, split panes, config files, or log search yet.

## License

[MIT](./LICENSE)
