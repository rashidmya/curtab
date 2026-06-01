# curtab

Run multiple commands at once, each in its own **interactive terminal tab**.

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

> **Windows** (double quotes — most Windows shells don't support single quotes):
>
> ```bash
> curtab "npm run dev" "npm run api"
> ```
>
> In a `package.json` script **on Windows**, the double quotes must be escaped:
>
> ```json
> { "scripts": { "dev": "curtab \"npm run web\" \"npm run api\"" } }
> ```

## Options

| Flag | Description |
| --- | --- |
| `-n`, `--names "a, b"` | Custom tab names (comma-separated), matched to commands in order. Missing names fall back to the command text. |
| `-h`, `--help` | Show usage and exit. |
| `-v`, `--version` | Print the curtab version and exit. |

By default each tab is labelled with its command. Give friendlier names with
`-n` / `--names` — the names map to commands left-to-right:

```bash
curtab -n 'web, api' 'npm run dev' 'npm run api'
#  ● 1:web   ● 2:api
```

## Keyboard controls

| Key | Action |
| --- | --- |
| `Alt`+`1`…`9` | Switch to tab |
| `Alt`+`R` | Restart the active process |
| `Alt`+`K` | Kill the active process |
| Mouse wheel / `Shift`+`PageUp`/`PageDown` | Scroll the active tab's history |
| `Ctrl`+`C` | Quit (kills all processes) |

Tab status: `●` running · `✓` exited ok · `✕` exited with error · `■` killed.

## Notes

- Tab switching uses `Alt`+digit, not `Ctrl`+digit — most terminals can't
  transmit `Ctrl`+digit as a distinct key.
- In the VS Code terminal, `Shift`+`PageUp`/`PageDown` is captured by the editor;
  use the mouse wheel to scroll history there.
- Full-screen apps (`vim`, `htop`, …) work via the embedded terminal emulator;
  very exotic escape sequences may not render perfectly.

## Develop

```bash
npm install
npm run build
node dist/index.js 'npm run dev' 'npm run api'   # or: npm link && curtab ...
npm test                                          # run the test suite
```

## License

[MIT](./LICENSE)
