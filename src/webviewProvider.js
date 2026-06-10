/**
 * Port Manager - Webview Provider
 */

const vscode = require("vscode");
const fs = require("fs");
const { getWebviewContent } = require("./webview");
const { getListeningPorts, killByPid, getPidForPort } = require("./portService");
const { stopByPid } = require("./processManager");
const { getPresetForPort, getGhostRows } = require("./presetBridge");
const { createStoppedTracker } = require("./stoppedTracker");
const { buildPresetTemplate, upsertPreset, findPresetByLabel, findPresetByPort, addNote, updatePreset } = require("./appsJsonTemplate");
const { APPS_FILE } = require("./config");
const { MESSAGE_TYPE, COMMAND, RUNTIME_STATE } = require("./constants");
const { createLogger } = require("./utils/logger");
const log = createLogger("Port Manager · Webview");

/**
 * Create the webview provider for the sidebar panel
 * @param {Object} [deps]
 * @param {Object} [deps.appStore] - AppStore instance for preset awareness
 * @param {Object} [deps.stoppedTracker] - StoppedTracker instance (created if not provided)
 * @returns {Object} WebviewViewProvider
 */
function createWebviewProvider(deps = {}) {
  const appStore = deps.appStore || null;
  const stoppedTracker = deps.stoppedTracker || createStoppedTracker();

  return {
    resolveWebviewView(webviewView) {
      webviewView.webview.options = { enableScripts: true };
      webviewView.webview.html = getWebviewContent();

      webviewView.webview.onDidReceiveMessage((msg) => {
        console.log(`[port-manager] received: ${msg.command} port=${msg.port} pid=${msg.pid}`);
        handleMessage(msg, webviewView.webview, { appStore, stoppedTracker });
      });
    },
  };
}

/**
 * Handle messages from the webview
 * @param {Object} msg - Message from webview
 * @param {Object} webview - Webview instance
 * @param {Object} ctx - { appStore, stoppedTracker }
 */
function handleMessage(msg, webview, ctx) {
  const { appStore, stoppedTracker } = ctx;
  switch (msg.command) {
    case COMMAND.REFRESH:
      handleRefresh(webview, appStore, stoppedTracker);
      break;

    case COMMAND.KILL:
      handleKill(msg, webview, appStore, stoppedTracker);
      break;

    case COMMAND.STOP:
      handleStop(msg, webview, appStore, stoppedTracker);
      break;

    case COMMAND.START_PRESET:
      handleStartPreset(msg, webview, appStore, stoppedTracker);
      break;

    case COMMAND.STOP_PRESET:
      handleStopPreset(msg, webview, appStore, stoppedTracker);
      break;

    case COMMAND.FORGET_PRESET:
      handleForgetPreset(msg, webview, appStore, stoppedTracker);
      break;

    case COMMAND.FORGET_STOPPED:
      handleForgetStopped(msg, webview, stoppedTracker);
      break;

    case COMMAND.RESUME_STOPPED:
      handleResumeStopped(msg, webview, appStore, stoppedTracker);
      break;

    case COMMAND.OPEN_ADDRESS:
      handleOpenAddress(msg, webview);
      break;

    case COMMAND.PREVIEW_ADDRESS:
      handlePreviewAddress(msg, webview);
      break;

    case COMMAND.BULK_KILL:
      handleBulkKill(msg, webview, ctx);
      break;

    case COMMAND.SCAN:
      handleScan(msg, webview);
      break;

    case COMMAND.OPEN_APPS_JSON:
      handleOpenAppsJson(msg, webview);
      break;

    case COMMAND.SAVE_NOTE:
      handleSaveNote(msg, webview, appStore);
      break;
  }
}

/**
 * Send current ports to the webview, enriched with preset info and ghost rows.
 * Ghosts include BOTH preset-owned (with Resume) and pure stopped (no Resume).
 *
 * Notes are now stored inside each preset (apps.json -> presets[i].notes).
 * This function looks up the note for each row by finding the preset that
 * owns the port (via runtime, then defaultPort).
 *
 * @param {Object} webview
 * @param {Object} appStore
 * @param {Object} stoppedTracker
 */
async function handleRefresh(webview, appStore, stoppedTracker) {
  const livePorts = getListeningPorts();
  const livePortsSet = new Set(livePorts.map((p) => p.port));
  // Build a map of port -> process name for live ports (so we can
  // detect when a stopped entry's port is now bound by a *different*
  // process — i.e. the stopped entry is stale).
  const liveProcessByPort = new Map(livePorts.map((p) => [p.port, p.process]));

  // Resolve forwarded/external addresses for every live port. On a local
  // machine, asExternalUri is a no-op (returns the same URL). On a
  // remote/SSH machine, VS Code auto-creates a port-forwarding tunnel
  // and returns a client-resolvable URL (e.g. https://xyz.devtunnels.ms)
  // — that's the URL the user actually pastes into their browser.
  // Display this URL in the Forwarded Address column instead of the
  // raw localhost URL, so remote users see the working URL.
  const externalByPort = new Map();
  await Promise.all(livePorts.map(async (p) => {
    const localUrl = p.address || "";
    if (!localUrl) return;
    try {
      const external = await vscode.env.asExternalUri(vscode.Uri.parse(localUrl));
      externalByPort.set(p.port, external.toString());
    } catch {
      // Fallback: use the local URL on failure
      externalByPort.set(p.port, localUrl);
    }
  }));

  // Enrich each live port with its preset info (if owned by one),
  // its user-authored note, and the forwarded/external address.
  const enriched = livePorts.map((p) => {
    const preset = appStore ? getPresetForPort(appStore, p.port) : null;
    return {
      ...p,
      // Use the forwarded address on remote machines; otherwise keep
      // the local `p.address` (built by getListeningPorts).
      address: externalByPort.get(p.port) || p.address,
      preset,
      note: preset && typeof preset.note === "string" ? preset.note : "",
    };
  });

  // Ghost type 1: preset-owned, stopped (has Resume button)
  const presetGhosts = appStore ? getGhostRows(appStore, livePorts) : [];
  // Attach notes to preset ghosts too so the note column works for them.
  for (const g of presetGhosts) {
    if (g.preset && typeof g.preset.note === "string") {
      g.note = g.preset.note;
    } else {
      g.note = "";
    }
  }

  // Ghost type 2: pure stopped (no preset) — only if not already a live
  // or preset-ghost row. Each entry becomes a ghost with `_stopped: true`.
  //
  // Stale-entry auto-cleanup: if a stopped entry's port is now listening
  // but by a *different* process than what was recorded (e.g. user stopped
  // unsloth on port 2346, then jupyter-notebook started on the same port),
  // the stopped entry is stale and gets auto-removed. Without this, the
  // table would show a "ghost" unsloth row stuck under the live jupyter
  // row at the same port, which is confusing.
  const stoppedGhosts = [];
  if (stoppedTracker) {
    for (const entry of stoppedTracker.getAll()) {
      if (livePortsSet.has(entry.port)) {
        // Port is now live. If by a different process, the entry is
        // stale — auto-remove and skip. If by the same process, skip
        // silently (no need to show a ghost alongside the live row).
        //
        // Entries with `process: null` (older, pre-v1.0.11) are left
        // alone on purpose: we can't tell whether it's the same or a
        // different process, so the safer behavior is to keep the
        // ghost visible until the user FORGETs it.
        const liveProcess = liveProcessByPort.get(entry.port);
        if (entry.process && liveProcess && liveProcess !== entry.process) {
          log.info(
            `Auto-removing stale stopped entry for port ${entry.port} ` +
            `(recorded process "${entry.process}" replaced by "${liveProcess}")`
          );
          stoppedTracker.remove(entry.port);
        }
        continue;
      }
      if (presetGhosts.some((g) => g.port === entry.port)) continue;
        stoppedGhosts.push({
          _stopped: true,
          _ghost: true,
          port: entry.port,
          pid: null,
          // null is rendered as "unknown" by the webview so users can tell
          // older stopped entries (pre-v1.0.11) from newer ones.
          process: entry.process || null,
          state: "LISTEN",
          ram: "-",
          vram: "-",
          preset: null,
          stoppedAt: entry.stoppedAt || null,
          note: "",
        });
    }
  }

  webview.postMessage({
    type: MESSAGE_TYPE.PORTS,
    ports: enriched,
    ghosts: [...presetGhosts, ...stoppedGhosts],
  });
}

/**
 * Kill a single process. If the port is owned by a preset, stop the preset
 * (graceful) instead of force-killing the process. The preset's state moves
 * to STOPPED and the row stays visible with a Resume button.
 * @param {Object} msg
 * @param {Object} webview
 * @param {Object} appStore
 * @param {Object} stoppedTracker
 */
async function handleKill(msg, webview, appStore, stoppedTracker) {
  const presetInfo = appStore ? getPresetForPort(appStore, msg.port) : null;
  if (presetInfo) {
    const r = await appStore.stopPreset(presetInfo.label);
    if (r.ok) {
      webview.postMessage({
        type: MESSAGE_TYPE.STOPPED,
        port: msg.port,
        preset: presetInfo.label,
      });
    } else {
      webview.postMessage({
        type: MESSAGE_TYPE.STOP_ERROR,
        port: msg.port,
        error: r.error,
      });
    }
    setTimeout(() => handleRefresh(webview, appStore, stoppedTracker), 100);
    return;
  }

  // Non-preset port: force-kill the process, then track as stopped ghost
  try {
    // If the webview sent null/undefined pid, resolve it fresh from the scanner.
    let pid = msg.pid;
    if (!Number.isInteger(pid) || pid <= 0) {
      pid = getPidForPort(msg.port);
      if (!pid) {
        throw new Error("No process found listening on port " + msg.port);
      }
    }
    killByPid(pid);
    if (stoppedTracker && msg.port) {
      stoppedTracker.add(msg.port, {
        process: msg.process || null,
        pid,
      });
    }
    webview.postMessage({
      type: MESSAGE_TYPE.STOPPED,
      port: msg.port,
      stopped: true,
    });
  } catch (e) {
    webview.postMessage({
      type: MESSAGE_TYPE.KILL_ERROR,
      error: e.message,
    });
  }
  setTimeout(() => handleRefresh(webview, appStore, stoppedTracker), 100);
}

/**
 * Gracefully stop a single process (SIGTERM, no escalation).
 * If the port is owned by a preset, route through AppStore.stopPreset so
 * the runtime state is updated and the row can show Resume.
 * For non-preset ports, track the stopped port so the row stays visible.
 * @param {Object} msg
 * @param {Object} webview
 * @param {Object} appStore
 * @param {Object} stoppedTracker
 */
async function handleStop(msg, webview, appStore, stoppedTracker) {
  const presetInfo = appStore ? getPresetForPort(appStore, msg.port) : null;
  if (presetInfo) {
    const r = await appStore.stopPreset(presetInfo.label);
    if (r.ok) {
      webview.postMessage({
        type: MESSAGE_TYPE.STOPPED,
        port: msg.port,
        preset: presetInfo.label,
      });
    } else {
      webview.postMessage({
        type: MESSAGE_TYPE.STOP_ERROR,
        port: msg.port,
        error: r.error,
      });
    }
    setTimeout(() => handleRefresh(webview, appStore, stoppedTracker), 100);
    return;
  }

  // Non-preset port: raw SIGTERM, then track as stopped ghost
  // If pid is missing, resolve it from the scanner first.
  let pid = msg.pid;
  if (!Number.isInteger(pid) || pid <= 0) {
    pid = getPidForPort(msg.port);
    if (!pid) {
      webview.postMessage({
        type: MESSAGE_TYPE.STOP_ERROR,
        port: msg.port,
        error: "No process found listening on port " + msg.port,
      });
      setTimeout(() => handleRefresh(webview, appStore, stoppedTracker), 100);
      return;
    }
  }
  const result = await stopByPid(pid);
  if (result.ok) {
    if (stoppedTracker && msg.port) {
      stoppedTracker.add(msg.port, {
        process: msg.process || null,
        pid,
      });
    }
    webview.postMessage({
      type: MESSAGE_TYPE.STOPPED,
      port: msg.port,
      stopped: true,
    });
  } else {
    webview.postMessage({
      type: MESSAGE_TYPE.STOP_ERROR,
      port: msg.port,
      error: result.error,
    });
  }
  setTimeout(() => handleRefresh(webview, appStore, stoppedTracker), 100);
}

/**
 * Resume/start a preset by label. Used when the user clicks the Resume button
 * on a stopped preset row. When a preset is started, also remove its port
 * from the stopped tracker (in case it was tracked there too).
 * @param {Object} msg - {port, label}
 * @param {Object} webview
 * @param {Object} appStore
 * @param {Object} stoppedTracker
 */
async function handleStartPreset(msg, webview, appStore, stoppedTracker) {
  if (!appStore) {
    webview.postMessage({
      type: MESSAGE_TYPE.PRESET_START_ERROR,
      port: msg.port,
      error: "AppStore not available",
    });
    return;
  }
  const label = msg.label || (msg.preset && msg.preset.label);
  if (!label) {
    webview.postMessage({
      type: MESSAGE_TYPE.PRESET_START_ERROR,
      port: msg.port,
      error: "Preset label required",
    });
    return;
  }

  const r = await appStore.startPreset(label);
  if (r.ok) {
    // Remove the new (and old) port from the stopped tracker
    if (stoppedTracker) {
      stoppedTracker.remove(msg.port);
      if (r.port !== msg.port) stoppedTracker.remove(r.port);
    }
    webview.postMessage({
      type: MESSAGE_TYPE.PRESET_STARTED,
      port: r.port,
      label,
      pid: r.pid,
      bumped: r.bumped,
      defaultPort: r.defaultPort,
    });
  } else {
    webview.postMessage({
      type: MESSAGE_TYPE.PRESET_START_ERROR,
      port: msg.port,
      label,
      error: r.error,
    });
  }
  setTimeout(() => handleRefresh(webview, appStore, stoppedTracker), 100);
}

/**
 * Start a preset by label and post the result. If the command field is
 * still a placeholder ("TODO: replace..."), refuse to start — return
 * {ok: false, needsSetup: true} so the caller can open apps.json.
 *
 * @param {string} label
 * @param {Object} appStore
 * @param {Object} stoppedTracker
 * @param {number} currentPort - the port the user clicked from (for tracker cleanup)
 * @returns {Promise<{ok: boolean, port?: number, pid?: number, bumped?: boolean, defaultPort?: number, needsSetup?: boolean, error?: string}>}
 */
async function startPresetIfReady(label, appStore, stoppedTracker, currentPort) {
  // Look up the current preset definition to check the command
  const def = appStore.presets.find((p) => p.label === label);
  if (!def) {
    return { ok: false, error: "Preset not found: " + label };
  }
  if (typeof def.command !== "string" || /^TODO:/.test(def.command.trim())) {
    return { ok: false, needsSetup: true, label };
  }
  const r = await appStore.startPreset(label);
  if (r.ok && stoppedTracker && Number.isInteger(currentPort)) {
    stoppedTracker.remove(currentPort);
    if (r.port !== currentPort) stoppedTracker.remove(r.port);
  }
  return r;
}

/**
 * Stop a preset by label (used by Resume → Stop transitions on preset rows).
 * @param {Object} msg - {port, label}
 * @param {Object} webview
 * @param {Object} appStore
 * @param {Object} stoppedTracker
 */
async function handleStopPreset(msg, webview, appStore, stoppedTracker) {
  if (!appStore) return;
  const label = msg.label || (msg.preset && msg.preset.label);
  if (!label) return;
  await appStore.stopPreset(label);
  setTimeout(() => handleRefresh(webview, appStore, stoppedTracker), 100);
}

/**
 * Forget a preset: remove it from runtime state entirely.
 * Used by the × button on stopped preset rows. The row will disappear
 * on the next refresh, and the preset can be started fresh from the
 * Command Palette (which creates a new runtime entry).
 *
 * @param {Object} msg - {port, label}
 * @param {Object} webview
 * @param {Object} appStore
 */
function handleForgetPreset(msg, webview, appStore, stoppedTracker) {
  if (!appStore) return;
  const label = msg.label || (msg.preset && msg.preset.label);
  if (!label) return;
  const r = appStore.forgetPreset(label);
  // Also clear the port from the stopped tracker (in case it was there)
  if (stoppedTracker && msg.port) stoppedTracker.remove(msg.port);
  handleRefresh(webview, appStore, stoppedTracker);
  return r;
}

/**
 * Forget a stopped (non-preset) ghost: remove the port from the tracker
 * so the row disappears on the next refresh.
 * @param {Object} msg - {port}
 * @param {Object} webview
 * @param {Object} stoppedTracker
 */
function handleForgetStopped(msg, webview, stoppedTracker) {
  if (!stoppedTracker) return;
  if (!Number.isInteger(msg.port)) return;
  stoppedTracker.remove(msg.port);
  handleRefresh(webview, null, stoppedTracker);
}

/**
 * Open a URL in the user's default browser via vscode.env.openExternal.
 * @param {Object} msg - {url, port}
 * @param {Object} webview
 */
async function handleOpenAddress(msg, webview) {
  const url = (msg && typeof msg.url === "string") ? msg.url.trim() : "";
  if (!url) {
    webview.postMessage({
      type: MESSAGE_TYPE.ADDRESS_ERROR,
      port: msg.port,
      error: "No URL provided",
    });
    return;
  }
  // Validate URL: must be http(s) and parseable
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    webview.postMessage({
      type: MESSAGE_TYPE.ADDRESS_ERROR,
      port: msg.port,
      error: "Invalid URL: " + url,
    });
    return;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    webview.postMessage({
      type: MESSAGE_TYPE.ADDRESS_ERROR,
      port: msg.port,
      error: "Unsupported protocol: " + parsed.protocol,
    });
    return;
  }
  try {
    // vscode.env.asExternalUri is the key API for remote support.
    // On a local machine it's a no-op (returns the same URL). On a
    // remote machine it AUTOMATICALLY sets up a port-forwarding tunnel
    // and returns a publicly-resolvable URL (via dev tunnels). This is
    // what makes "Open in browser" work on remote.
    const externalUri = await vscode.env.asExternalUri(vscode.Uri.parse(url));
    const externalUrl = externalUri.toString();
    const opened = await vscode.env.openExternal(externalUri);
    if (opened === false) {
      webview.postMessage({
        type: MESSAGE_TYPE.ADDRESS_ERROR,
        port: msg.port,
        error: "OS refused to open URL (no handler). External URL: " + externalUrl,
      });
      return;
    }
    webview.postMessage({
      type: MESSAGE_TYPE.ADDRESS_OPENED,
      port: msg.port,
      url: externalUrl,
    });
  } catch (e) {
    const errMsg = (e && e.message) ? e.message : "no error message";
    webview.postMessage({
      type: MESSAGE_TYPE.ADDRESS_ERROR,
      port: msg.port,
      error: "Open URL failed: " + errMsg + ". URL: " + url,
    });
  }
}

/**
 * Open a URL as an in-editor preview using the Simple Browser
 * extension API. If the extension is not installed, falls back to
 * openExternal (the regular browser).
 * @param {Object} msg - {url, port}
 * @param {Object} webview
 */
async function handlePreviewAddress(msg, webview) {
  const url = (msg && typeof msg.url === "string") ? msg.url.trim() : "";
  if (!url) {
    webview.postMessage({
      type: MESSAGE_TYPE.ADDRESS_ERROR,
      port: msg.port,
      error: "No URL provided",
    });
    return;
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    webview.postMessage({
      type: MESSAGE_TYPE.ADDRESS_ERROR,
      port: msg.port,
      error: "Invalid URL: " + url,
    });
    return;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    webview.postMessage({
      type: MESSAGE_TYPE.ADDRESS_ERROR,
      port: msg.port,
      error: "Unsupported protocol: " + parsed.protocol,
    });
    return;
  }
  try {
    // Try to open as a Simple Browser (in-editor preview). The
    // "simpleBrowser.api.open" command is provided by VS Code's built-in
    // Simple Browser. If unavailable, fall back to openExternal.
    try {
      await vscode.commands.executeCommand("simpleBrowser.api.open", url, {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: true,
      });
    } catch (simpleBrowserErr) {
      // Fallback: open in the external browser
      await vscode.env.openExternal(parsed);
    }
    webview.postMessage({
      type: MESSAGE_TYPE.ADDRESS_OPENED,
      port: msg.port,
      url,
    });
  } catch (e) {
    webview.postMessage({
      type: MESSAGE_TYPE.ADDRESS_ERROR,
      port: msg.port,
      error: e.message,
    });
  }
}

/**
 * Resume a stopped (non-preset) row. We don't know the original command,
 * so we open apps.json in the editor with a template entry prepended
 * (or appended) so the user can set up the command, then click RESUME
 * again to actually start the process.
 *
 * @param {Object} msg - {port, process}
 * @param {Object} webview
 * @param {Object} appStore
 */
async function handleResumeStopped(msg, webview, appStore, stoppedTracker) {
  const port = Number.isInteger(msg.port) ? msg.port : 0;
  const processName = (msg.process || "").trim();

  if (!port || !processName) {
    webview.postMessage({
      type: MESSAGE_TYPE.PRESET_START_ERROR,
      port: msg.port,
      error: "Process name and port are required",
    });
    return;
  }

  // Reload presets in case apps.json was edited externally
  if (appStore) appStore.loadPresets();

  // Check if a preset for this process already exists in apps.json.
  // Match by exact label first, then by port. If we find one, we either
  // start it directly (if the command is real) or open apps.json for
  // setup (if the command is still a placeholder).
  const existingByLabel = findPresetByLabel(processName);
  const existingByPort = existingByLabel ? null : findPresetByPort(port);
  const existingPreset = existingByLabel || existingByPort;

  if (existingPreset) {
    // Try to start the preset if its command is set
    if (appStore) {
      const r = await startPresetIfReady(existingPreset.label, appStore, stoppedTracker, port);
      if (r.ok) {
        webview.postMessage({
          type: MESSAGE_TYPE.PRESET_STARTED,
          port: r.port,
          label: existingPreset.label,
          pid: r.pid,
          bumped: r.bumped,
          defaultPort: r.defaultPort,
        });
        setTimeout(() => handleRefresh(webview, appStore, stoppedTracker), 100);
        return;
      }
      if (!r.needsSetup) {
        webview.postMessage({
          type: MESSAGE_TYPE.PRESET_START_ERROR,
          port,
          label: existingPreset.label,
          error: r.error,
        });
        setTimeout(() => handleRefresh(webview, appStore, stoppedTracker), 100);
        return;
      }
      // needsSetup: command is still a placeholder. Open apps.json.
    }
    try {
      const doc = await vscode.workspace.openTextDocument(APPS_FILE);
      const editor = await vscode.window.showTextDocument(doc);
      const text = doc.getText();
      const line = text.split("\n").findIndex((l) => l.indexOf('"label": "' + existingPreset.label + '"') !== -1);
      if (line >= 0) {
        const pos = new vscode.Position(line, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos));
      }
    } catch (e) {
      webview.postMessage({
        type: MESSAGE_TYPE.PRESET_START_ERROR,
        port,
        error: "Failed to open apps.json: " + e.message,
      });
      return;
    }

    webview.postMessage({
      type: MESSAGE_TYPE.APPS_JSON_OPENED,
      port,
      label: existingPreset.label,
      alreadyExists: true,
      needsSetup: true,
    });
    return;
  }

  // No existing preset — build the template and insert it
  let preset;
  try {
    preset = buildPresetTemplate({ process: processName, port });
  } catch (e) {
    webview.postMessage({
      type: MESSAGE_TYPE.PRESET_START_ERROR,
      port,
      error: e.message,
    });
    return;
  }

  const upsert = upsertPreset({ appsFile: APPS_FILE, preset });
  if (!upsert.ok) {
    webview.postMessage({
      type: MESSAGE_TYPE.PRESET_START_ERROR,
      port,
      error: upsert.error,
    });
    return;
  }

  if (upsert.exists) {
    // Race: someone else created the preset. Open apps.json for the existing one.
    try {
      const doc = await vscode.workspace.openTextDocument(APPS_FILE);
      await vscode.window.showTextDocument(doc);
    } catch {}
    if (appStore) appStore.loadPresets();
    webview.postMessage({
      type: MESSAGE_TYPE.APPS_JSON_OPENED,
      port,
      label: upsert.existing.label,
      alreadyExists: true,
      needsSetup: true,
    });
    return;
  }

  if (appStore) appStore.loadPresets();

  // Open apps.json in the editor (template was just inserted)
  try {
    const doc = await vscode.workspace.openTextDocument(APPS_FILE);
    const editor = await vscode.window.showTextDocument(doc);
    const text = doc.getText();
    const line = text.split("\n").findIndex((l) => l.indexOf('"label": "' + preset.label + '"') !== -1);
    if (line >= 0) {
      const pos = new vscode.Position(line, 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos));
    }
  } catch (e) {
    webview.postMessage({
      type: MESSAGE_TYPE.PRESET_START_ERROR,
      port,
      error: "Failed to open apps.json: " + e.message,
    });
    return;
  }

  webview.postMessage({
    type: MESSAGE_TYPE.APPS_JSON_OPENED,
    port,
    label: preset.label,
    alreadyExists: false,
    needsSetup: true,
  });
}

/**
 * Kill multiple processes
 * @param {Object} msg
 * @param {Object} webview
 */
function handleBulkKill(msg, webview, ctx) {
  const { stoppedTracker } = ctx || {};
  const ports = getListeningPorts();
  let killed = 0;

  for (const targetPort of msg.ports) {
    const found = ports.find((p) => p.port === targetPort);
    let pid = found && Number.isInteger(found.pid) ? found.pid : getPidForPort(targetPort);
    if (pid) {
      try {
        killByPid(pid);
        if (stoppedTracker) {
          stoppedTracker.add(targetPort, {
            process: found ? found.process : null,
            pid,
          });
        }
        killed++;
      } catch {
        // Continue with other ports
      }
    }
  }

  webview.postMessage({
    type: MESSAGE_TYPE.KILLED,
    port: `${killed}個のポート`,
  });
}

/**
 * Scan a port range
 * @param {Object} msg
 * @param {Object} webview
 */
function handleScan(msg, webview) {
  const ports = getListeningPorts();
  const usedSet = new Set(ports.map((p) => p.port));

  let freeCount = 0;
  let usedCount = 0;

  for (let p = msg.from; p <= msg.to; p++) {
    if (usedSet.has(p)) {
      usedCount++;
    } else {
      freeCount++;
    }
  }

  webview.postMessage({
    type: MESSAGE_TYPE.SCAN_RESULT,
    used: usedCount,
    free: freeCount,
  });
}

/**
 * Open the apps.json file in the editor. If the file doesn't exist yet,
 * create it with an empty array (`[]`) so the user starts from a
 * clean slate. After opening, post APPS_JSON_OPENED so the webview
 * can show a confirmation toast.
 *
 * @param {Object} msg
 * @param {Object} webview
 */
async function handleOpenAppsJson(msg, webview) {
  try {
    // If the file doesn't exist, create an empty array file first
    // so the editor doesn't open a "File not found" error.
    if (!fs.existsSync(APPS_FILE)) {
      fs.writeFileSync(APPS_FILE, "[]\n", "utf-8");
      log.info(`Created empty apps.json at ${APPS_FILE}`);
    }
    const doc = await vscode.workspace.openTextDocument(APPS_FILE);
    await vscode.window.showTextDocument(doc, {
      preview: false,
      viewColumn: vscode.ViewColumn.Beside,
    });
    webview.postMessage({
      type: MESSAGE_TYPE.APPS_JSON_OPENED,
      path: APPS_FILE,
    });
  } catch (e) {
    log.error("handleOpenAppsJson failed", e);
    webview.postMessage({
      type: MESSAGE_TYPE.ADDRESS_ERROR,
      error: "Failed to open apps.json: " + (e.message || "unknown error"),
    });
  }
}

/**
 * Save (or clear) a user-authored note for a port. The note is
 * attached to the preset that owns the port (looked up by runtime,
 * then by defaultPort). If no preset exists for the port, a stub
 * preset is auto-created with:
 *   - label: <process name> or "TO ADD"
 *   - command: "TO ADD"
 *   - defaultPort: <the port>
 *   - openBrowser: false
 *   - notes: [text]
 *
 * Empty text removes the note from the preset's notes array.
 *
 * @param {Object} msg - {port, text, process?}
 * @param {Object} webview
 * @param {Object} appStore
 */
function handleSaveNote(msg, webview, appStore) {
  const port = Number.isInteger(msg.port) ? msg.port : parseInt(msg.port, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    webview.postMessage({
      type: MESSAGE_TYPE.NOTE_ERROR,
      port: msg.port,
      error: "Invalid port",
    });
    return;
  }
  const text = typeof msg.text === "string" ? msg.text : "";

  // Find the preset that owns this port
  let label = null;
  if (appStore) {
    const presetInfo = getPresetForPort(appStore, port);
    if (presetInfo) label = presetInfo.label;
  }
  if (!label && appStore) {
    // Try the runtime map (for stopped presets)
    const rt = appStore.runtime instanceof Map
      ? appStore.runtime
      : new Map(Object.entries(appStore.runtime || {}));
    for (const [rtLabel, rtVal] of rt.entries()) {
      if (!rtVal) continue;
      const realPort = typeof rtVal.port === "string" && rtVal.port.startsWith("000")
        ? parseInt(rtVal.port.slice(3), 10)
        : (Number.isInteger(rtVal.port) ? rtVal.port : (Number.isInteger(rtVal.lastPort) ? rtVal.lastPort : null));
      if (realPort === port) { label = rtLabel; break; }
    }
  }
  if (!label) {
    // Fall back to a preset whose defaultPort matches
    const byPort = findPresetByPort(port);
    if (byPort) label = byPort.label;
  }

  // If empty text and no preset exists, nothing to do
  if (!text && !label) {
    webview.postMessage({
      type: MESSAGE_TYPE.NOTE_SAVED,
      port,
      text: "",
    });
    return;
  }

  // If no preset exists for this port, auto-create a stub
  let created = false;
  if (!label) {
    const processName = (typeof msg.process === "string" && msg.process.trim())
      ? msg.process.trim()
      : "";
    const stubLabel = processName || "TO ADD";
    const stub = {
      label: stubLabel,
      command: "TO ADD",
      defaultPort: port,
      openBrowser: false,
      note: text || "",
    };
    const r = upsertPreset({ preset: stub });
    if (!r.ok) {
      webview.postMessage({
        type: MESSAGE_TYPE.NOTE_ERROR,
        port,
        error: "Failed to create stub preset: " + r.error,
      });
      return;
    }
    created = true;
    label = stubLabel;
    webview.postMessage({
      type: MESSAGE_TYPE.NOTE_SAVED,
      port,
      text,
      label,
      created,
    });
    return;
  }

  if (!text) {
    // Empty text — clear the preset's note field
    const r = updatePreset(label, { note: "" });
    if (!r.ok) {
      webview.postMessage({
        type: MESSAGE_TYPE.NOTE_ERROR,
        port,
        error: r.error,
      });
      return;
    }
    webview.postMessage({
      type: MESSAGE_TYPE.NOTE_SAVED,
      port,
      text: "",
      label,
    });
    return;
  }

  // Add the note to the preset's notes array (de-dupe)
  const r = addNote({ label, port, text, appStore });
  if (!r.ok) {
    webview.postMessage({
      type: MESSAGE_TYPE.NOTE_ERROR,
      port,
      error: r.error,
    });
    return;
  }
  webview.postMessage({
    type: MESSAGE_TYPE.NOTE_SAVED,
    port,
    text,
    label,
    created: r.created,
  });
}

module.exports = { createWebviewProvider };
