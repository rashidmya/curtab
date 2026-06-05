# curtab

[![Latest Release](https://img.shields.io/github/v/release/rashidmya/curtab?label=Release)](https://github.com/rashidmya/curtab/releases)
[![License](https://img.shields.io/github/license/rashidmya/curtab?label=License)](https://github.com/rashidmya/curtab/blob/main/LICENSE)
[![CI Status](https://img.shields.io/github/actions/workflow/status/rashidmya/curtab/ci.yml?label=CI&logo=github)](https://github.com/rashidmya/curtab/actions/workflows/ci.yml)

Run multiple commands at once, each in its own **interactive terminal tab**.

![curtab demo](./demo.gif)

Each command runs in a real pseudo-terminal, so it stays fully interactive —
colors, prompts, and keyboard input all work.

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

### Options

| Option | Description |
| --- | --- |
| `-n, --names 'a,b'` | Custom tab names (comma-separated), matched to commands in order. Missing names fall back to the command text. |
| `--cwd 'a,b'` | Per-command working directories (comma-separated), matched to commands in order. Missing entries use the launch dir. |
| `-c, --color` | Color-code tab status (running / ok / error / killed). |
| `-h, --help` | Show help and exit. |
| `-v, --version` | Print the curtab version and exit. |

## Controls

Press the `Ctrl`+`B` leader, then:

| Key | Action |
| --- | --- |
| `1`…`9` | Switch to tab N |
| `n` / `p` | Next / previous tab |
| `r` | Restart the active process |
| `k` | Kill the active process |
| `Ctrl`+`B` | Send a literal `Ctrl`+`B` to the app |

## Develop

```bash
npm install
npm run build
node dist/index.js 'npm run dev' 'npm run api'   # or: npm link && curtab ...
npm test                                          # run the test suite
```

## License

[MIT](./LICENSE)
