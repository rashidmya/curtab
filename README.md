# curtab

[![Latest Release](https://img.shields.io/github/v/release/rashidmya/curtab?label=Release)](https://github.com/rashidmya/curtab/releases)
[![License](https://img.shields.io/github/license/rashidmya/curtab?label=License)](https://github.com/rashidmya/curtab/blob/main/LICENSE)
[![CI Status](https://img.shields.io/github/actions/workflow/status/rashidmya/curtab/ci.yml?label=CI&logo=github)](https://github.com/rashidmya/curtab/actions/workflows/ci.yml)

Run multiple commands at once, each in its own **interactive terminal tab**.

![curtab demo](./demo.gif)

Each command runs in a real pseudo-terminal (PTY), so processes stay fully
interactive — prompts, colors, and keyboard input all work. curtab renders each
tab itself (tmux-style): a tab bar pinned on top, key hints on the bottom, and
per-tab scrollback you can scroll with the mouse wheel. Inactive tabs keep
running and buffering output, so switching back is instant.

```bash
curtab 'npm run dev' 'npm run api'
```

## Install

```bash
npm install -g curtab     # or: pnpm add -g curtab  /  yarn global add curtab
```

## Usage

Each argument is **one full command**, run through your shell. Quote commands
that contain spaces — curtab never splits an argument on spaces, so
`curtab npm run dev` is three separate commands, not one.

**macOS / Linux** (single quotes):

```bash
curtab 'npm run dev' 'npm run api'
```

**Windows** (double quotes — most Windows shells don't support single quotes):

```bash
curtab "npm run dev" "npm run api"
```

In a `package.json` script **on Windows**, the double quotes must be escaped:

```json
{ "scripts": { "dev": "curtab \"npm run web\" \"npm run api\"" } }
```

## Controls

Tabs are pinned on top; key hints on the bottom. curtab uses a `Ctrl`+`B` leader,
like a multiplexer. Press `Ctrl`+`B`, then:

| Key | Action |
| --- | --- |
| `1`…`9` | Switch to tab N |
| `n` / `p` | Next / previous tab |
| `r` | Restart the active process |
| `k` | Kill the active process |
| `Ctrl`+`B` | Send a literal `Ctrl`+`B` to the app |

Scroll a tab's history with the **mouse wheel** or `Shift`+`PageUp` /
`Shift`+`PageDown`. Select with **`Shift`+drag** and copy with **`Ctrl`+`Shift`+`C`**
(your terminal's native selection — curtab captures the wheel, so hold `Shift` to
select). `Ctrl`+`C` (without the leader) quits curtab and kills all processes.

Tab status: `●` running · `✓` exited ok · `✕` exited with error · `■` killed.

## Develop

```bash
npm install
npm run build
node dist/index.js 'npm run dev' 'npm run api'   # or: npm link && curtab ...
npm test                                          # run the test suite
```

## License

[MIT](./LICENSE)
