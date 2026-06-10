/**
 * Port Manager - VS Code Extension
 *
 * View listening ports, check availability, and kill processes.
 * Works on macOS, Windows, and Linux.
 */

const fs = require("fs");
const vscode = require("vscode");
const { createWebviewProvider } = require("./webviewProvider");
const { registerCommands } = require("./commands");
const { ensureConfig, APPS_FILE } = require("./config");
const { AppStore } = require("./appStore");
const { createStoppedTracker } = require("./stoppedTracker");
const { createLogger } = require("./utils/logger");
const { addNote, readAppsFile, writeAppsFile } = require("./appsJsonTemplate");

const log = createLogger("Port Manager");

/**
 * One-time migration: move port-keyed notes from the legacy
 * apps.json.__notes map into per-preset `note` strings.
 *
 * For each {port, text} in __notes:
 *   - If a runtime/preset owns the port, set that preset's `note`
 *     field to the text (overwriting any existing note — there's
 *     only ever one note per preset now).
 *   - Otherwise, auto-create a stub preset with `command: "TO ADD"`
 *     and `note: <text>`.
 *
 * After migration, the __notes key is removed.
 */
function migrateLegacyNotes(appStore) {
  if (!fs.existsSync(APPS_FILE)) return { ok: true, migrated: 0 };
  const obj = readAppsFile();
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: true, migrated: 0 };
  }
  const legacy = obj.__notes;
  if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) {
    return { ok: true, migrated: 0 };
  }
  let migrated = 0;
  for (const [portStr, text] of Object.entries(legacy)) {
    if (typeof text !== "string" || text.length === 0) continue;
    const port = parseInt(portStr, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    const r = addNote({ port, text, appStore });
    if (r.ok) migrated++;
    else log.warn(`migrateLegacyNotes: failed to migrate port ${port}: ${r.error}`);
  }
  // Remove the __notes key
  const fresh = readAppsFile() || {};
  if (fresh.__notes) {
    delete fresh.__notes;
    writeAppsFile(fresh);
  }
  if (migrated > 0) {
    log.info(`Migrated ${migrated} legacy port notes into per-preset note fields`);
  }
  return { ok: true, migrated };
}

/**
 * Extension activation
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  // Ensure ~/.vscode/.portmanager/apps.json exists before anything else reads it.
  const init = ensureConfig();
  if (!init.ok) {
    vscode.window.showErrorMessage(`Port Manager: failed to initialize config: ${init.error}`);
    // Continue anyway — AppStore.loadPresets() will report the error.
  }

  // Preset store: load presets once at activation.
  const appStore = new AppStore();
  const loaded = appStore.loadPresets();
  if (!loaded.ok) {
    vscode.window.showErrorMessage(`Port Manager: failed to load presets: ${loaded.error}`);
  }

  // Load persisted runtime state (preset lifecycle from previous sessions).
  const runtime = appStore.loadRuntime();
  if (!runtime.ok) {
    vscode.window.showWarningMessage(`Port Manager: failed to load runtime state: ${runtime.error}`);
  } else if (runtime.count > 0) {
    console.log(`[Port Manager] Restored ${runtime.count} preset runtime entries from disk`);
  }

  // Stopped-processes tracker: load persisted state from disk.
  const stoppedTracker = createStoppedTracker();
  const stoppedLoad = stoppedTracker.load();
  if (!stoppedLoad.ok) {
    vscode.window.showWarningMessage(`Port Manager: failed to load stopped state: ${stoppedLoad.error}`);
  } else if (stoppedLoad.count > 0) {
    console.log(`[Port Manager] Restored ${stoppedLoad.count} stopped-process entries from disk`);
  }

  // One-time migration: move port-keyed __notes into per-preset notes.
  try {
    const mig = migrateLegacyNotes(appStore);
    if (mig.migrated > 0) {
      console.log(`[Port Manager] Migrated ${mig.migrated} port notes from __notes to per-preset notes`);
    }
  } catch (e) {
    log.warn("migrateLegacyNotes failed", e);
  }

  // Register sidebar webview provider.
  const provider = createWebviewProvider({ appStore, stoppedTracker });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("portManager.panel", provider)
  );

  // Register commands (including preset start/stop/restart)
  registerCommands(context, { appStore, stoppedTracker });
}

/**
 * Extension deactivation
 */
function deactivate() {}

module.exports = { activate, deactivate };
