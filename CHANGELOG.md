# Change Log

All notable changes to the **Port Manager** extension will be documented in this file. Dates are in `YYYY-MM-DD` format.

## [1.0.3] - 2026-06-10

### Changed
- Forked from [saisai-web/port-manager](https://github.com/saisai-web/port-manager) and rebranded under `hdnguyen`
- README simplified

## [1.0.0] - 2026-06-10

### Added
- Sidebar webview panel showing all listening TCP ports with real-time RAM and VRAM
- Forwarded Address column (`localhost:2345`) with copy / open-in-browser / preview-in-editor icons
- Per-port Note column (free-form text stored inside the matching preset in `apps.json`)
- Preset lifecycle: `STOPPED → STARTING → RUNNING → STOPPING` with Start / Stop / Restart / Resume / Forget actions
- Auto-created stub preset when a note is added for a port with no preset
- Synthetic `000<port>` port encoding for stopped presets so ghost rows never visually collide with a live row at the same real port
- Auto-bump `defaultPort` to the next free port if the requested one is taken
- Bulk select-and-kill, range scan, and `Ctrl+Shift+P` commands
- Stale-runtime auto-cleanup: a preset marked `RUNNING` whose PID is dead is reconciled to `STOPPED` on next refresh
- Stopped-port auto-cleanup: a stopped ghost whose port is now bound by a different process is auto-removed
- Auto-refresh every 10s, paused when the panel is hidden (battery-friendly)
- Batched `ps` for RAM lookup (one spawn for all PIDs, instead of one per row)
- `vscode.env.asExternalUri` for opening URLs on remote/SSH machines (auto-creates a tunnel)
- Cross-platform: macOS (`lsof`), Linux (`lsof`/`ss`), Windows (`netstat`/`tasklist`)
- Adapts to VS Code theme: dark, light, high contrast
- Configuration in `~/.vscode/.portmanager/` (plain JSON, hand-editable)
- Marketplace-ready metadata: `publisher`, `repository`, `bugs`, `homepage`, `galleryBanner`, `engines`, `categories`, `keywords`

### Notes
- First marketplace release by `hdnguyen`. Prior development was under the internal `port-manager-saiki` publisher.
- Requires VS Code 1.80.0 or later.
