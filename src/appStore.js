/**
 * Port Manager — App Store.
 *
 * Loads preset definitions from apps.json, tracks their runtime lifecycle
 * (STOPPED → STARTING → RUNNING → STOPPING → ERROR), and orchestrates
 * process start/stop via the injected ProcessManager.
 *
 * Persistence uses atomic write: write to apps.json.tmp, then rename.
 * Read errors are surfaced as `{ ok: false, error }` rather than thrown.
 */

const fs = require("fs");
const path = require("path");
const { APPS_FILE, RUNTIME_FILE } = require("./config");
const { RUNTIME_STATE, STOPPED_PORT_PREFIX } = require("./constants");
const { findFreePort } = require("./portResolver");
const { createLogger } = require("./utils/logger");

const log = createLogger("Port Manager · Store");

function validatePreset(p) {
  if (!p || typeof p !== "object") return "preset must be an object";
  if (!p.label || typeof p.label !== "string") return "preset.label is required";
  if (!p.command || typeof p.command !== "string") return "preset.command is required";
  if (!Number.isInteger(p.defaultPort) || p.defaultPort < 1) return "preset.defaultPort must be a positive integer";
  return null;
}

class AppStore {
  /**
   * @param {Object} [deps]
   * @param {string} [deps.appsFile]
   * @param {string} [deps.runtimeFile]
   * @param {Object} [deps.processManager] - must expose spawn() and kill()
   * @param {Function} [deps.findFreePort]  - injected for testability
   * @param {Object} [deps.fs]              - injected for testability
   */
  constructor(deps = {}) {
    this.appsFile = deps.appsFile || APPS_FILE;
    this.runtimeFile = deps.runtimeFile || RUNTIME_FILE;
    this.processManager = deps.processManager || require("./processManager");
    this.findFreePort = deps.findFreePort || findFreePort;
    this.fs = deps.fs || fs;
    this.path = deps.path || path;

    /** @type {Array<Object>} */
    this.presets = [];
    /**
     * @type {Map<string, {state: string, pid: number|null, port: number|null, lastPort: number|null, lastError: string|null, startedAt: number|null}>}
     *
     * Port encoding rule (v1.0.31+):
     *   - When a preset is RUNNING / STARTING / STOPPING, `port` holds the
     *     real port number the process is/was bound to.
     *   - When a preset is STOPPED / ERROR, `port` holds a synthetic
     *     "remembered" port of the form `000<lastPort>` (see PORT_PREFIX in
     *     constants.js) and `lastPort` holds the real port number. This
     *     prevents the ghost row from clashing with a live process that
     *     later takes over the same real port (e.g. user stops unsloth
     *     on 2346, then jupyter-notebook binds 2346 — without the
     *     prefix the ghost would be hidden under the live row, with
     *     the prefix they are clearly distinct).
     *   - On RESUME, the real port is recomputed from `defaultPort` (with
     *     auto-bump via findFreePort), so the stored lastPort is just
     *     informational.
     */
    this.runtime = new Map();
  }

  // ─── Persistence ──────────────────────────────────────────────────────

  loadPresets() {
    try {
      if (!this.fs.existsSync(this.appsFile)) {
        this.presets = [];
        return { ok: true, presets: [] };
      }
      const raw = this.fs.readFileSync(this.appsFile, "utf-8");
      const data = JSON.parse(raw);

      // Support both formats:
      //   Legacy:    [ { label, command, ... }, ... ]
      //   Current:   { presets: [ ... ], __notes: { ... } }
      // The current format was introduced in v1.0.36 to keep all user
      // config in one file. If a file is in either shape, the presets
      // list is extracted. Notes (in the current shape) are ignored
      // here — they are loaded by the notesTracker.
      let presetList;
      if (Array.isArray(data)) {
        presetList = data;
      } else if (data && typeof data === "object" && Array.isArray(data.presets)) {
        presetList = data.presets;
      } else {
        return { ok: false, error: "apps.json must contain a JSON array or an object with a 'presets' array" };
      }

      const valid = [];
      const errors = [];
      for (const p of presetList) {
        const err = validatePreset(p);
        if (err) errors.push(`${p && p.label ? p.label : "(unnamed)"}: ${err}`);
        else valid.push(p);
      }
      this.presets = valid;
      for (const e of errors) log.warn(`invalid preset skipped: ${e}`);
      return { ok: true, presets: valid, errors };
    } catch (e) {
      log.error("loadPresets failed", e);
      return { ok: false, error: e.message };
    }
  }

  savePresets() {
    try {
      const tmp = `${this.appsFile}.tmp`;
      this.fs.writeFileSync(tmp, JSON.stringify(this.presets, null, 2), "utf-8");
      this.fs.renameSync(tmp, this.appsFile);
      return { ok: true };
    } catch (e) {
      log.error("savePresets failed", e);
      return { ok: false, error: e.message };
    }
  }

  getPresets() {
    return this.presets.map((p) => ({
      ...p,
      runtime: this.runtime.get(p.label) || {
        state: RUNTIME_STATE.STOPPED,
        pid: null,
        port: null,
        lastPort: null,
        lastError: null,
        startedAt: null,
      },
    }));
  }

  // ─── Runtime state ────────────────────────────────────────────────────

  _setState(label, partial) {
    const prev = this.runtime.get(label) || {
      state: RUNTIME_STATE.STOPPED,
      pid: null,
      port: null,
      lastPort: null,
      lastError: null,
      startedAt: null,
    };
    this.runtime.set(label, { ...prev, ...partial });
    this._persist();
  }

  /**
   * Encode a port into the synthetic "000<port>" form used by the
   * webview for stopped preset ghost rows. If the input is already a
   * synthetic port string (starts with STOPPED_PORT_PREFIX), it is
   * returned as-is. If it's a number, the prefix is prepended. If
   * the number is missing, fall back to lastPort. If both are
   * missing, returns null.
   *
   * @param {number|string|null} port
   * @param {number|null} lastPort
   * @returns {string|null}
   */
  _encodeStoppedPort(port, lastPort) {
    if (typeof port === "string" && port.startsWith(STOPPED_PORT_PREFIX)) {
      return port;
    }
    const real = Number.isInteger(port) ? port : (Number.isInteger(lastPort) ? lastPort : null);
    if (real == null) return null;
    return STOPPED_PORT_PREFIX + real;
  }

  _findPreset(label) {
    return this.presets.find((p) => p.label === label);
  }

  // ─── Runtime persistence ─────────────────────────────────────────────

  /**
   * Load runtime state from disk. Called once at extension activation.
   * Corrupt or missing file → start with empty runtime.
   * @returns {{ok: boolean, count?: number, error?: string}}
   */
  loadRuntime() {
    try {
      if (!this.fs.existsSync(this.runtimeFile)) {
        return { ok: true, count: 0 };
      }
      const raw = this.fs.readFileSync(this.runtimeFile, "utf-8");
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        log.warn("runtime.json is not an object; ignoring");
        return { ok: true, count: 0 };
      }

      // Validate each entry; skip invalid ones
      let count = 0;
      let reconciled = 0;
      let migrated = 0;
      for (const [label, rt] of Object.entries(data)) {
        if (!rt || typeof rt !== "object") continue;
        if (!rt.state) continue;
        // Normalize: ensure pid is number or null
        const pid = Number.isInteger(rt.pid) ? rt.pid : null;
        const lastError = typeof rt.lastError === "string" ? rt.lastError : null;
        const startedAt = Number.isInteger(rt.startedAt) ? rt.startedAt : null;

        // v1.0.31+ port encoding:
        //   - RUNNING/STARTING/STOPPING → port is the real number
        //   - STOPPED/ERROR           → port is `"000<lastPort>"` string
        //                                (synthetic, never equals a real
        //                                 listening port) and lastPort is
        //                                 the real number for display
        //   - any state               → port may be null if unknown
        //
        // Migration from v1.0.30 and earlier: old files had port as a
        // plain number for STOPPED presets. We re-encode to the new
        // scheme on load, persisting the change.
        let port;
        let lastPort = Number.isInteger(rt.lastPort) ? rt.lastPort : null;
        if (typeof rt.port === "string" && rt.port.startsWith(STOPPED_PORT_PREFIX)) {
          // Already in new format
          port = rt.port;
          if (!lastPort) {
            const n = parseInt(rt.port.slice(STOPPED_PORT_PREFIX.length), 10);
            if (Number.isInteger(n)) lastPort = n;
          }
        } else if (Number.isInteger(rt.port)) {
          // Legacy format. If state is STOPPED/ERROR, re-encode to new
          // format. If state is RUNNING/STARTING, port is a real number.
          if (rt.state === RUNTIME_STATE.STOPPED || rt.state === RUNTIME_STATE.ERROR) {
            port = STOPPED_PORT_PREFIX + rt.port;
            lastPort = rt.port;
            migrated++;
            log.info(
              `loadRuntime: migrated '${label}' port=${rt.port} → ${port} ` +
              `(lastPort=${lastPort})`
            );
          } else {
            port = rt.port;
          }
        } else {
          port = null;
        }

        const normalized = {
          state: String(rt.state),
          pid,
          port,
          lastPort,
          lastError,
          startedAt,
        };

        // Reconcile: if the stored state is RUNNING/STARTING but the PID
        // is dead, mark the preset as STOPPED. This is the most common
        // cause of the "is already RUNNING" error: the process was killed
        // externally but the runtime state wasn't updated.
        if (
          (normalized.state === RUNTIME_STATE.RUNNING || normalized.state === RUNTIME_STATE.STARTING) &&
          normalized.pid
        ) {
          const alive = this.processManager.isAlive
            ? this.processManager.isAlive(normalized.pid)
            : true;
          if (!alive) {
            log.warn(
              `loadRuntime: '${label}' was ${normalized.state} (pid=${normalized.pid}) ` +
              `but process is dead — marking STOPPED`
            );
            normalized.state = RUNTIME_STATE.STOPPED;
            normalized.pid = null;
            // Re-encode the port into the synthetic "000<port>" form
            // and remember the real port in lastPort. This way the
            // ghost row never collides with a live process that
            // later takes over the same real port.
            normalized.lastPort = typeof normalized.port === "number"
              ? normalized.port
              : normalized.lastPort;
            normalized.port = this._encodeStoppedPort(normalized.port, normalized.lastPort);
            reconciled++;
          }
        }

        this.runtime.set(label, normalized);
        count++;
      }
      if (reconciled > 0 || migrated > 0) this._persist();
      return { ok: true, count, reconciled, migrated };
    } catch (e) {
      log.error("loadRuntime failed", e);
      return { ok: false, error: e.message };
    }
  }

  /**
   * Persist the current runtime to disk. Called after every state change.
   * Atomic write: write to .tmp, then rename.
   * Failures are logged but do not throw into the extension host.
   */
  _persist() {
    try {
      const data = Object.fromEntries(this.runtime.entries());
      const tmp = `${this.runtimeFile}.tmp`;
      this.fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
      this.fs.renameSync(tmp, this.runtimeFile);
    } catch (e) {
      log.error("_persist failed", e);
    }
  }

  getRuntime(label) {
    return this.runtime.get(label) || {
      state: RUNTIME_STATE.STOPPED,
      pid: null,
      port: null,
      lastPort: null,
      lastError: null,
      startedAt: null,
    };
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────

  async startPreset(label) {
    const preset = this._findPreset(label);
    if (!preset) return { ok: false, error: `Unknown preset: ${label}` };

    const current = this.getRuntime(label);

    // Recover from stale RUNNING state: if the runtime says RUNNING but
    // the stored PID is dead, treat the preset as stopped and proceed
    // with a fresh start. This happens when a process is killed externally
    // (e.g. by the user in a terminal) without our stopPreset being called.
    if (current.state === RUNTIME_STATE.RUNNING && current.pid) {
      const alive = this.processManager.isAlive
        ? this.processManager.isAlive(current.pid)
        : true;
      if (!alive) {
        log.warn(
          `startPreset: '${label}' was marked RUNNING (pid=${current.pid}) ` +
          `but the process is dead — recovering`
        );
        this._setState(label, {
          state: RUNTIME_STATE.STOPPED,
          pid: null,
          // Re-encode the port into the synthetic "000<port>" form
          // and remember the real port in lastPort. The ghost row
          // will then never collide with a live process that later
          // takes over the same real port.
          lastPort: typeof current.port === "number" ? current.port : current.lastPort,
          port: this._encodeStoppedPort(current.port, current.lastPort),
        });
        // Re-read the (now updated) runtime
        return this.startPreset(label);
      }
    }

    if (current.state === RUNTIME_STATE.RUNNING || current.state === RUNTIME_STATE.STARTING) {
      return { ok: false, error: `Preset '${label}' is already ${current.state}` };
    }

    this._setState(label, { state: RUNTIME_STATE.STARTING, lastError: null });

    const portResult = await this.findFreePort(preset.defaultPort);
    if (!portResult.ok) {
      this._setState(label, { state: RUNTIME_STATE.ERROR, lastError: portResult.error });
      return { ok: false, error: portResult.error };
    }
    const port = portResult.port;

    const spawnResult = await this.processManager.spawn(preset.command, { port });
    if (!spawnResult.ok) {
      this._setState(label, { state: RUNTIME_STATE.ERROR, lastError: spawnResult.error });
      return { ok: false, error: spawnResult.error };
    }

    this._setState(label, {
      state: RUNTIME_STATE.RUNNING,
      pid: spawnResult.pid,
      port,
      startedAt: Date.now(),
    });

    return { ok: true, pid: spawnResult.pid, port, defaultPort: preset.defaultPort, bumped: port !== preset.defaultPort };
  }

  async stopPreset(label) {
    const preset = this._findPreset(label);
    if (!preset) return { ok: false, error: `Unknown preset: ${label}` };

    const current = this.getRuntime(label);
    if (current.state !== RUNTIME_STATE.RUNNING && current.state !== RUNTIME_STATE.STARTING) {
      return { ok: false, error: `Preset '${label}' is not running` };
    }

    // If the stored PID is already dead (e.g. process was killed externally
    // before stopPreset was called), just mark STOPPED — no need to try
    // to kill a dead process.
    if (current.pid && this.processManager.isAlive && !this.processManager.isAlive(current.pid)) {
      log.warn(`stopPreset: '${label}' pid=${current.pid} already dead — just marking stopped`);
      this._setState(label, {
        state: RUNTIME_STATE.STOPPED,
        pid: null,
        // Remember the port we were on so the ghost row can show it.
        // The port itself is re-encoded to the synthetic "000<port>"
        // form so the ghost can never collide with a live process
        // that later takes over the same real port.
        lastPort: typeof current.port === "number" ? current.port : current.lastPort,
        port: this._encodeStoppedPort(current.port, current.lastPort),
        lastError: null,
      });
      return { ok: true };
    }

    this._setState(label, { state: RUNTIME_STATE.STOPPING });

    const pid = current.pid;
    const killResult = await this.processManager.kill(pid);

    this._setState(label, {
      state: killResult.ok ? RUNTIME_STATE.STOPPED : RUNTIME_STATE.ERROR,
      pid: null,
      // Remember the port we were on so the ghost row can show it.
      // The port itself is re-encoded to the synthetic "000<port>"
      // form so the ghost can never collide with a live process
      // that later takes over the same real port.
      lastPort: typeof current.port === "number" ? current.port : current.lastPort,
      port: this._encodeStoppedPort(current.port, current.lastPort),
      lastError: killResult.ok ? null : killResult.error,
    });

    return killResult.ok
      ? { ok: true }
      : { ok: false, error: killResult.error };
  }

  async restartPreset(label) {
    const stopResult = await this.stopPreset(label);
    // Stop is best-effort when the preset was never running.
    if (!stopResult.ok && !/not running/i.test(stopResult.error)) {
      return stopResult;
    }
    return this.startPreset(label);
  }

  /**
   * Remove a preset from the runtime entirely. Used by the webview's
   * "forget" (×) button on stopped preset rows — the user explicitly
   * wants the row gone, regardless of whether the preset is "running".
   *
   * @param {string} label
   * @returns {{ok: boolean, error?: string}}
   */
  forgetPreset(label) {
    if (!label) return { ok: false, error: "Label required" };
    if (!this.runtime.has(label)) {
      return { ok: true }; // already forgotten — no-op
    }
    this.runtime.delete(label);
    this._persist();
    return { ok: true };
  }
}

module.exports = { AppStore, RUNTIME_STATE };
