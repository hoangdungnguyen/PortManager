/**
 * Port Manager - VS Code Commands
 */

const vscode = require("vscode");
const { getListeningPorts, killByPid, checkPortFree } = require("./portService");
const { PORT } = require("./constants");

/**
 * Register all extension commands
 * @param {vscode.ExtensionContext} context
 * @param {Object} [deps]
 * @param {Object} [deps.appStore] - AppStore instance; if absent, preset commands are skipped
 */
function registerCommands(context, deps = {}) {
  context.subscriptions.push(
    vscode.commands.registerCommand("portManager.show", showPortsCommand),
    vscode.commands.registerCommand("portManager.checkPort", checkPortCommand),
    vscode.commands.registerCommand("portManager.killPort", killPortCommand)
  );

  if (deps.appStore) {
    context.subscriptions.push(
      vscode.commands.registerCommand("portManager.startPreset", () => startPresetCommand(deps.appStore)),
      vscode.commands.registerCommand("portManager.stopPreset", () => stopPresetCommand(deps.appStore)),
      vscode.commands.registerCommand("portManager.restartPreset", () => restartPresetCommand(deps.appStore))
    );
  }
}

/**
 * Show listening ports in a QuickPick
 */
async function showPortsCommand() {
  const ports = getListeningPorts();

  if (ports.length === 0) {
    vscode.window.showInformationMessage("No listening ports found");
    return;
  }

  const items = ports.map((p) => ({
    label: `:${p.port}`,
    description: `${p.process} (PID: ${p.pid})`,
    port: p.port,
    pid: p.pid,
    process: p.process,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Listening ports — select to kill",
  });

  if (!picked) return;

  const confirm = await vscode.window.showWarningMessage(
    `Kill port :${picked.port} (${picked.process})?`,
    { modal: true },
    "KILL"
  );

  if (confirm === "KILL") {
    await killProcess(picked.pid, picked.port);
  }
}

/**
 * Check if a port is available
 */
async function checkPortCommand() {
  const input = await vscode.window.showInputBox({
    prompt: "Enter port number to check",
    placeHolder: "e.g. 3000",
    validateInput: validatePortNumber,
  });

  if (!input) return;

  const port = parseInt(input, 10);
  const free = await checkPortFree(port);

  if (free) {
    vscode.window.showInformationMessage(`Port :${port} is available`);
    return;
  }

  const ports = getListeningPorts();
  const found = ports.find((p) => p.port === port);
  const detail = found ? ` (${found.process}, PID: ${found.pid})` : "";

  const action = await vscode.window.showWarningMessage(
    `Port :${port} is in use${detail}`,
    "KILL"
  );

  if (action === "KILL" && found) {
    await killProcess(found.pid, port);
  }
}

/**
 * Kill port(s) by number input
 */
async function killPortCommand() {
  const input = await vscode.window.showInputBox({
    prompt: "Enter port(s) to close (comma-separated for multiple)",
    placeHolder: "e.g. 3000 or 3000,8080,5432",
  });

  if (!input) return;

  const ports = getListeningPorts();
  const targets = parsePortInput(input, ports);

  if (targets.length === 0) {
    vscode.window.showWarningMessage("No matching ports found");
    return;
  }

  const desc = targets.map((t) => `:${t.port} (${t.process})`).join(", ");
  const confirm = await vscode.window.showWarningMessage(
    `${targets.length} port(s) to kill: ${desc}`,
    { modal: true },
    "KILL"
  );

  if (confirm !== "KILL") return;

  let ok = 0;
  let fail = 0;

  for (const t of targets) {
    try {
      killByPid(t.pid);
      ok++;
    } catch {
      fail++;
    }
  }

  vscode.window.showInformationMessage(`Done: ${ok} succeeded / ${fail} failed`);
}

/**
 * Kill a process and show result message
 * @param {number} pid
 * @param {number} port
 */
async function killProcess(pid, port) {
  try {
    killByPid(pid);
    vscode.window.showInformationMessage(`Port :${port} killed`);
  } catch (e) {
    vscode.window.showErrorMessage(`Kill failed: ${e.message}`);
  }
}

/**
 * Validate port number input
 * @param {string} value
 * @returns {string|null} Error message or null
 */
function validatePortNumber(value) {
  const n = parseInt(value, 10);
  if (!n || n < PORT.MIN || n > PORT.MAX) {
    return `Enter a value between ${PORT.MIN}-${PORT.MAX}`;
  }
  return null;
}

/**
 * Parse comma-separated port input
 * @param {string} input
 * @param {Array} availablePorts
 * @returns {Array}
 */
function parsePortInput(input, availablePorts) {
  return input
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => n > 0)
    .map((n) => availablePorts.find((p) => p.port === n))
    .filter(Boolean);
}

// ─── Preset commands ─────────────────────────────────────────────────────

/**
 * Show a QuickPick of presets and start the chosen one.
 */
async function startPresetCommand(appStore) {
  const result = appStore.loadPresets();
  if (!result.ok) {
    vscode.window.showErrorMessage(`Failed to load presets: ${result.error}`);
    return;
  }
  const presets = appStore.getPresets();
  if (presets.length === 0) {
    vscode.window.showInformationMessage("No presets configured. Add one to apps.json first.");
    return;
  }

  const items = presets.map((p) => ({
    label: p.label,
    description: `port ${p.defaultPort} · ${p.runtime.state}`,
    detail: p.runtime.lastError ? `Last error: ${p.runtime.lastError}` : undefined,
    preset: p,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Select a preset to start",
  });
  if (!picked) return;

  const r = await appStore.startPreset(picked.preset.label);
  if (r.ok) {
    const where = r.bumped ? `:${r.port} (bumped from :${r.defaultPort})` : `:${r.port}`;
    vscode.window.showInformationMessage(
      `Started '${picked.preset.label}' on ${where}, PID ${r.pid}`
    );
  } else {
    vscode.window.showErrorMessage(`Failed to start '${picked.preset.label}': ${r.error}`);
  }
}

async function stopPresetCommand(appStore) {
  const presets = appStore.getPresets().filter(
    (p) => p.runtime.state === "RUNNING" || p.runtime.state === "STARTING"
  );
  if (presets.length === 0) {
    vscode.window.showInformationMessage("No running presets to stop.");
    return;
  }

  const items = presets.map((p) => ({
    label: p.label,
    description: `PID ${p.runtime.pid} on :${p.runtime.port}`,
    preset: p,
  }));
  const picked = await vscode.window.showQuickPick(items, { placeHolder: "Select a preset to stop" });
  if (!picked) return;

  const r = await appStore.stopPreset(picked.preset.label);
  if (r.ok) {
    vscode.window.showInformationMessage(`Stopped '${picked.preset.label}'`);
  } else {
    vscode.window.showErrorMessage(`Failed to stop '${picked.preset.label}': ${r.error}`);
  }
}

async function restartPresetCommand(appStore) {
  const presets = appStore.getPresets();
  if (presets.length === 0) {
    vscode.window.showInformationMessage("No presets configured.");
    return;
  }

  const items = presets.map((p) => ({
    label: p.label,
    description: `${p.runtime.state} (port ${p.defaultPort})`,
    preset: p,
  }));
  const picked = await vscode.window.showQuickPick(items, { placeHolder: "Select a preset to restart" });
  if (!picked) return;

  const r = await appStore.restartPreset(picked.preset.label);
  if (r.ok) {
    const where = r.bumped ? `:${r.port} (bumped from :${r.defaultPort})` : `:${r.port}`;
    vscode.window.showInformationMessage(
      `Restarted '${picked.preset.label}' on ${where}, PID ${r.pid}`
    );
  } else {
    vscode.window.showErrorMessage(`Failed to restart '${picked.preset.label}': ${r.error}`);
  }
}

module.exports = { registerCommands };
