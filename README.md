# curtab

[![Latest Release](https://img.shields.io/github/v/release/rashidmya/curtab?label=Release)](https://github.com/rashidmya/curtab/releases)
[![License](https://img.shields.io/github/license/rashidmya/curtab?label=License)](https://github.com/rashidmya/curtab/blob/main/LICENSE)
[![CI Status](https://img.shields.io/github/actions/workflow/status/rashidmya/curtab/ci.yml?label=CI&logo=github)](https://github.com/rashidmya/curtab/actions/workflows/ci.yml)

Run multiple commands at once, each in its own **interactive terminal tab**.

![curtab demo](./demo.gif)

Each command runs in a real pseudo-terminal (PTY), so processes stay fully
interactive — prompts, colors, and keyboard input all work. Switch between tabs
with the keyboard; inactive tabs keep running and buffering output.

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

## Keyboard controls

| Key | Action |
| --- | --- |
| `Ctrl`+`B` then `1`…`9` | Switch to tab |
| `Ctrl`+`B` then `n` / `p` | Next / previous tab |
| `Ctrl`+`B` then `r` | Restart the active process |
| `Ctrl`+`B` then `k` | Kill the active process |
| Mouse wheel / `Shift`+`PageUp`/`PageDown` | Scroll the active tab's history |
| `Ctrl`+`C` | Quit (kills all processes) |

`Ctrl`+`B` is a leader key: press and release it, then press the command key.

Tab status: `●` running · `✓` exited ok · `✕` exited with error · `■` killed.

## Notes
- In the VS Code terminal, `Shift`+`PageUp`/`PageDown` is captured by the editor;
  use the mouse wheel to scroll history there.

## Develop

```bash
npm install
npm run build
node dist/index.js 'npm run dev' 'npm run api'   # or: npm link && curtab ...
npm test                                          # run the test suite
```

## License

[MIT](./LICENSE)
