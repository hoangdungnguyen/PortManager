# Port Manager — Project Summary

A VS Code extension that lists, kills, and manages your listening ports — RAM, VRAM, presets, and notes — without leaving the editor.

This document explains what the project is, what it does, and the journey it took to get here.

---

## What it does

Open the **Port Manager** view in the VS Code Activity Bar. The panel shows every TCP port your machine is listening on, with:

- **Process name** and **PID** of whoever owns the port
- **RAM** and **VRAM** usage per process
- **Forwarded Address** — the URL you can actually open (on local: `localhost:2345`; on remote/SSH: the tunneled URL via VS Code's port-forwarding)
- **Per-port Note** — free-form text annotations ("OpenLPSM bot", "jpnotebook", "Unsloth", …)
- **One-click Kill** (with confirmation) and **Bulk Kill** for selected rows
- **Presets** — start / stop / resume for long-running apps; auto-bump `defaultPort` to the next free port
- **Range Scan** — find free ports in a range
- **Auto-refresh every 10s**, paused when the panel is hidden (battery-friendly)

---

## Project layout

The repository is now flat — all files are directly under the project root (no `port-manager-base/` subfolder).

```
.
├── .git/                  # git history
├── .gitattributes         # line-ending normalization for cross-platform builds
├── .gitignore             # excludes node_modules/, *.vsix, build artifacts
├── .vscodeignore          # what vsce excludes from the .vsix package
├── CHANGELOG.md           # release notes
├── LICENSE                # MIT (with attribution to original author)
├── README.md              # user-facing docs
├── images/
│   └── icon.png           # marketplace + activity-bar icon (846×846, transparent)
├── package.json           # extension manifest (publisher, version, commands, views)
├── package-lock.json      # pinned dependency versions
├── port-manager-1.0.3.vsix  # pre-built marketplace package (gitignored in new repos)
├── scripts/
│   └── push-to-fork.sh    # one-command push helper (reads $GH_TOKEN or prompts)
└── src/
    ├── appsJsonTemplate.js   # apps.json read/write + preset CRUD + note API
    ├── appStore.js           # preset lifecycle (STOPPED → STARTING → RUNNING → STOPPING)
    ├── commands.js           # command palette commands
    ├── config.js             # filesystem paths (~/.vscode/.portmanager/)
    ├── constants.js          # message types, command names, enums
    ├── extension.js          # entry point — activation, command registration
    ├── portResolver.js       # find a free port with auto-bump
    ├── portService.js        # port detection (lsof/ss/netstat) + batched RAM/VRAM
    ├── presetBridge.js       # map runtime state <-> preset definitions
    ├── processManager.js     # cross-platform process kill
    ├── stoppedTracker.js     # persist ghost rows for non-preset stops
    ├── webviewProvider.js    # webview message handling
    ├── utils/
    │   ├── formatBytes.js
    │   ├── logger.js
    │   └── parseCommand.js
    └── webview/
        ├── index.js          # HTML template generator
        ├── script.js         # client-side JS
        └── styles.js         # CSS
```

Runtime data lives in `~/.vscode/.portmanager/`:
- `apps.json` — preset definitions
- `runtime.json` — live state of each preset
- `stopped.json` — non-preset ghost rows
- All persisted as plain JSON, hand-editable

---

## Build & development

```bash
npm install
npm run package     # produces .vsix in project root
```

Press `F5` in VS Code to launch the Extension Development Host with the extension loaded.

---

## Publishing to VS Code Marketplace

1. Create a publisher at https://marketplace.visualstudio.com/manage/publishers/ (Publisher ID: `hdnguyen`)
2. Generate a Personal Access Token (scope: `Marketplace → Manage`) at https://dev.azure.com/
3. `vsce login hdnguyen` (paste the PAT)
4. `npm run publish`

See `README.md` for the user-facing feature list and command reference.

---

## How it got here — a brief build log

This project evolved over many iterations. Here's the condensed history:

### 1. The starting point (v1.0.0, upstream `saisai-web/port-manager`)

A working extension with a sidebar panel, search, sort, kill, bulk kill, range scan, and command palette integration. The upstream repo's `publisher` was `port-manager-saiki`, and the code lived under a `port-manager-base/` subfolder.

### 2. Preset lifecycle (v1.0.6 – v1.0.17)

Added the concept of **presets** — user-managed app definitions in `apps.json` with `label`, `command`, `defaultPort`, `openBrowser`. Each preset has a runtime lifecycle: `STOPPED → STARTING → RUNNING → STOPPING → ERROR`. Added **Start / Stop / Restart / Resume / Forget** actions.

Key bug along the way: the `STOP` button didn't work reliably because inline `onclick="stop(' + process + ')"` handlers couldn't handle process names with special characters. Fix: moved to **event delegation** — a single `tbody` click listener + `data-action` attributes + `onActionClick()` dispatcher. This was the v1.0.14 fix that made the action buttons robust.

### 3. Ghost rows and stale-state recovery (v1.0.18 – v1.0.21)

Stopping a process keeps the row visible as a "ghost" so the user can RESUME it. Added:
- `stopped.json` tracking for non-preset processes
- Stale-runtime reconciliation: if a preset is marked `RUNNING` but its PID is dead, mark it `STOPPED` automatically
- Stale-ghost cleanup: if a stopped process's port is now bound by a different process, remove the ghost

### 4. Forwarded Address column (v1.0.21 – v1.0.28)

Added a new column showing the URL the user can open in a browser. On local: `http://localhost:2345`. On remote/SSH: the URL was hard to display because `localhost` on the server is not the same as `localhost` on the client.

Key bug: the webview script had a backtick inside a comment, which closed the surrounding template literal and broke the entire webview silently. Fix: removed backticks from comments.

Key feature: integrated `vscode.env.asExternalUri()` to get the actual tunneled URL on remote machines. Click "Open in browser" auto-creates a dev tunnel.

### 5. Synthetic port encoding (v1.0.31)

When a preset was stopped, its `port` was a real number that could collide with a live process that took over the same port. The ghost row and the live row appeared stacked at the same port number — confusing.

**The rule:** when a preset is stopped, encode its port as `"000<lastPort>"` (synthetic string that can never be a real port). The ghost row's display port becomes `:0002346` while a live process at the real port shows as `:2346` — visually separated. The real port is stored in `lastPort`. On RESUME, the preset starts at `defaultPort` (with auto-bump), ignoring the old port entirely.

### 6. UI cleanup (v1.0.33 – v1.0.34)

- Removed the `:` prefix from the Port column (`2345` instead of `:2345`)
- Removed `http://` from the Forwarded Address display (`localhost:2345` instead of `http://localhost:2345`)
- Fixed a V8 parser bug where a regex ending in `//` got interpreted as a line comment

### 7. Lightweight pass (v1.0.42)

- Batched `ps` for RAM lookup — 1 spawn for all PIDs instead of 1 per port (6× faster on hosts with many ports)
- Slower auto-refresh (3s → 10s) + pause when panel is hidden
- Removed dead code (`removeNote`, unused imports)

### 8. Note column (v1.0.35 – v1.0.40)

Added a per-port **Note** column. Initial implementation stored notes as a per-port map (`__notes`) in apps.json, but the user wanted notes per-preset instead. After several iterations, the final schema is:

```json
{
  "presets": [
    {
      "label": "kimaki",
      "command": "npx -y kimaki@latest",
      "defaultPort": 29988,
      "openBrowser": false,
      "note": "OpenLPSM bot"
    }
  ]
}
```

Notes are a single string per preset. When a note is added for a port that has no preset, a stub preset is auto-created with `command: "TO ADD"` and `defaultPort: <port>` so the user can later fill in the real command.

### 9. Forwarded Address — show the real URL (v1.0.1 of the new repo)

Final fix: in `handleRefresh`, call `asExternalUri` for every live port and send the resolved URL to the webview for display. Now the panel shows the actual working URL on remote machines (`http://localhost:50290` for the tunneled kimaki), not the local server URL.

### 10. Re-identification (v1.0.2)

The old `port-manager-saiki` publisher was awkward. Switched to `hdnguyen` as the publisher and author. All metadata updated (repository, bugs, homepage, galleryBanner, etc.).

### 11. Icon (v1.0.3)

The final marketplace icon is a 846×846 transparent PNG showing three "port books" (HTTP 80, HTTPS 443, API 8080) on a shelf with a glowing cyan double-arrow. Generated externally and dropped into `images/icon.png`.

### 12. Marketplace-ready cleanup

Final pass:
- Stripped dead code (`isStoppedPort`, `decodeStoppedPort`, `MAX_NOTE_LENGTH` exports removed)
- Added `.gitignore` (excludes `node_modules/`, `*.vsix`, build artifacts)
- Added `.gitattributes` (LF line endings, binary markers for PNGs)
- Updated `.vscodeignore` for the .vsix package
- Rewrote README to be short and focused
- Moved all old backups, plan files, and previous .vsix artifacts to `~/TrashBin/port-manager-history/`

---

## What's next

To publish this publicly:
1. Fork the upstream `saisai-web/port-manager` on GitHub to your `hdnguyen` account
2. Push this repo to the fork (use `bash scripts/push-to-fork.sh`)
3. Create the `hdnguyen` publisher on the VS Code Marketplace
4. `vsce login hdnguyen` + `npm run publish`
