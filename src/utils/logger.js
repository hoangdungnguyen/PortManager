/**
 * Thin wrapper around vscode.OutputChannel for extension diagnostics.
 *
 * Usage:
 *   const { createLogger } = require('./utils/logger');
 *   const log = createLogger('Port Manager');
 *   log.info('started');
 *   log.error('boom', err);
 *
 * The logger gracefully degrades when `vscode` is unavailable (e.g. when
 * unit-testing without launching VS Code), routing messages to console.
 */

let vscode = null;
try {
  vscode = require("vscode");
} catch {
  // vscode module not available — fall back to console
}

function createLogger(name) {
  const channel = vscode ? vscode.window.createOutputChannel(name) : null;

  function write(level, args) {
    const stamp = new Date().toISOString();
    const line = `[${stamp}] [${level}] ${args
      .map((a) => (a instanceof Error ? a.stack || a.message : typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ")}`;

    if (channel) {
      channel.appendLine(line);
    } else {
      // eslint-disable-next-line no-console
      console.log(line);
    }
  }

  return {
    name,
    info: (...args) => write("INFO", args),
    warn: (...args) => write("WARN", args),
    error: (...args) => write("ERROR", args),
    debug: (...args) => write("DEBUG", args),
    show: () => channel && channel.show(),
    dispose: () => channel && channel.dispose(),
  };
}

module.exports = { createLogger };
