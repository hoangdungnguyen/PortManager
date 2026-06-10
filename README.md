# ⚡ Port Manager

**List, kill, and manage your listening ports — RAM, VRAM, presets, and notes.**

A VS Code sidebar panel showing every listening port on your machine, with one-click kill, range scan, presets for restartable apps, and per-port notes.

**Forked from** [saisai-web/port-manager](https://github.com/saisai-web/port-manager) and improved with new features and bug fixes.

## ✨ Features

- **Sidebar panel** — all listening ports, RAM, VRAM, Forwarded Address, per-port Note
- **One-click kill** (with confirmation) and bulk kill
- **Range scan** to find free ports
- **Presets** — Start / Stop / Resume for long-running apps (auto-bump port if taken)
- **Per-port Note** — annotate each port; auto-creates a stub preset if none exists
- **Smart ghost rows** — stopped presets stay visible (with RESUME); auto-clean when the port is reused
- **Forwarded Address** — `asExternalUri` integration so the panel shows the working URL on remote/SSH
- **Auto-refresh every 10s** (paused when the panel is hidden)

## 🚀 Quick start

1. Open the **Port Manager** activity bar icon (server icon `$(server)`)
2. The panel lists all listening ports
3. Click `↗` next to a row to open the address in your browser
4. Click `KILL` to stop a process, or `✎` to edit a port's note

## ⚙️ Config

Data lives in `~/.vscode/.portmanager/`:
- `apps.json` — preset definitions (`label`, `command`, `defaultPort`, `openBrowser`, `note`)
- `runtime.json` — live state of each preset
- `stopped.json` — non-preset ghost rows

Use the **Edit Config** button in the toolbar to open `apps.json` in the editor.

## ⌨️ Commands

| Command | Description |
|---------|-------------|
| `Port Manager: Show Listening Ports` | Quick Pick list → select a port to kill |
| `Port Manager: Check Port Availability` | Enter a port → see if it's free |
| `Port Manager: Kill Port` | Enter port(s) → kill (comma-separated for bulk) |
| `Port Manager: Start Preset` | Start a preset by name |
| `Port Manager: Stop Preset` | Stop a running preset |
| `Port Manager: Restart Preset` | Stop + start a preset |
| `Port Manager: Edit Config` | Open `apps.json` |

## 🛠️ Development

```bash
npm install
npm run package     # produces .vsix in project root
```

Press `F5` in VS Code to launch the Extension Development Host.

## 🖥️ Supported platforms

| Platform | Port detection | Kill |
|----------|----------------|------|
| macOS    | `lsof`          | `SIGTERM` / `SIGKILL` |
| Linux    | `lsof` / `ss`   | `SIGTERM` / `SIGKILL` |
| Windows  | `netstat` + `tasklist` | `taskkill /F` |

## 📝 License

[MIT](LICENSE.txt)
