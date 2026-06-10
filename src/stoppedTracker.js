/**
 * Port Manager — Stopped Processes Tracker.
 *
 * Tracks all ports the user has stopped (via STOP button), regardless of
 * whether they were preset-owned. The webview renders these as "stopped
 * ghost" rows so they don't disappear when the underlying process dies.
 *
 * Persistence: ~/.vscode/.portmanager/stopped.json (atomic write).
 *
 * Pure module: no I/O side effects at import time, no global state.
 * All filesystem operations take an injected `fs`.
 */

const fs = require("fs");
const { execSync } = require("child_process");
const { STOPPED_FILE } = require("./config");
const { createLogger } = require("./utils/logger");

const log = createLogger("Port Manager · Stopped");

/**
 * Best-effort lookup of a process name for a given PID.
 * Uses `ps -o comm=` on Unix. Returns null if PID is dead or lookup fails.
 * @param {number} pid
 * @param {Object} [deps]
 * @param {Function} [deps.exec] - Injected for tests
 * @returns {string|null}
 */
function getProcessNameForPid(pid, deps = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const exec = deps.exec || execSync;
  try {
    // Is the PID alive?
    try {
      process.kill(pid, 0);
    } catch {
      return null; // process is gone
    }
    if (process.platform === "win32") {
      // Use tasklist to get image name
      const out = exec(`tasklist /FI "PID eq ${pid}" /NH /FO CSV 2>NUL`, {
        encoding: "utf-8",
        timeout: 2000,
      });
      const m = out.match(/^"([^"]+)"/m);
      return m ? m[1].trim() : null;
    }
    // Unix: ps -o comm= gives the executable name
    const out = exec(`ps -o comm= -p ${pid} 2>/dev/null || true`, {
      encoding: "utf-8",
      timeout: 2000,
    });
    const name = out.trim().split("\n")[0] || "";
    return name || null;
  } catch {
    return null;
  }
}

/**
 * Create a tracker instance.
 * @param {Object} [deps]
 * @param {string} [deps.stoppedFile]
 * @param {Object} [deps.fs]
 * @returns {{
 *   load: () => {ok: boolean, count?: number, error?: string},
 *   save: () => {ok: boolean, error?: string},
 *   add: (port: number, info?: Object) => void,
 *   remove: (port: number) => void,
 *   getAll: () => Array<{port: number, ...}>,
 *   has: (port: number) => boolean,
 * }}
 */
function createStoppedTracker(deps = {}) {
  const stoppedFile = deps.stoppedFile || STOPPED_FILE;
  const _fs = deps.fs || fs;

  /** @type {Map<number, Object>} */
  const store = new Map();

  function load() {
    try {
      if (!_fs.existsSync(stoppedFile)) {
        return { ok: true, count: 0 };
      }
      const raw = _fs.readFileSync(stoppedFile, "utf-8");
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) {
        log.warn("stopped.json is not an array; ignoring");
        return { ok: true, count: 0 };
      }

      let count = 0;
      let backfilled = 0;
      for (const entry of data) {
        if (!entry || !Number.isInteger(entry.port)) continue;
        let process = typeof entry.process === "string" ? entry.process : null;
        const pid = Number.isInteger(entry.pid) ? entry.pid : null;

        // Backfill: if process name is missing but the stored PID is
        // still alive, look it up. This recovers process names for
        // entries written before v1.0.11 (when the webview didn't
        // send the process name in STOP messages).
        if (!process && pid) {
          const name = getProcessNameForPid(pid);
          if (name) {
            process = name;
            backfilled++;
            log.info(`Backfilled process name for port ${entry.port}: ${name}`);
          }
        }

        store.set(entry.port, {
          port: entry.port,
          process,
          pid,
          stoppedAt: Number.isInteger(entry.stoppedAt) ? entry.stoppedAt : null,
          presetLabel: typeof entry.presetLabel === "string" ? entry.presetLabel : null,
        });
        count++;
      }
      if (backfilled > 0) save(); // persist backfilled entries
      return { ok: true, count, backfilled };
    } catch (e) {
      log.error("load stopped.json failed", e);
      return { ok: false, error: e.message };
    }
  }

  function save() {
    try {
      const data = Array.from(store.values());
      const tmp = `${stoppedFile}.tmp`;
      _fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
      _fs.renameSync(tmp, stoppedFile);
      return { ok: true };
    } catch (e) {
      log.error("save stopped.json failed", e);
      return { ok: false, error: e.message };
    }
  }

  function add(port, info = {}) {
    if (!Number.isInteger(port)) return;
    store.set(port, {
      port,
      process: info.process || null,
      pid: Number.isInteger(info.pid) ? info.pid : null,
      stoppedAt: Number.isInteger(info.stoppedAt) ? info.stoppedAt : Date.now(),
      presetLabel: typeof info.presetLabel === "string" ? info.presetLabel : null,
    });
    save();
  }

  function remove(port) {
    if (store.delete(port)) save();
  }

  function getAll() {
    return Array.from(store.values());
  }

  function has(port) {
    return store.has(port);
  }

  return { load, save, add, remove, getAll, has };
}

module.exports = { createStoppedTracker };
