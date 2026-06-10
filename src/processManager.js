/**
 * Port Manager — Process spawn & kill.
 *
 * Responsibilities:
 *   - spawn(command, vars)   → parse, substitute, spawn detached, return PID
 *   - kill(pid, graceMs?)    → SIGTERM, wait up to grace, then SIGKILL
 *
 * Dependencies are injected for testability. The default `exec` and `kill`
 * are real, but tests can pass stubs.
 */

const { spawn: nodeSpawn, exec: nodeExec } = require("child_process");
const { PLATFORM, KILL_GRACE_MS } = require("./constants");
const { parseCommand, substituteVars } = require("./utils/parseCommand");
const { createLogger } = require("./utils/logger");

const log = createLogger("Port Manager · Process");

/**
 * Spawn a detached process. The parent VS Code extension does NOT wait for
 * the child — `detached: true` + `child.unref()` lets the process outlive
 * the extension.
 *
 * Async because `child_process.spawn` reports ENOENT/EACCES on the 'error'
 * event, not via a thrown exception.
 *
 * @param {string} commandStr
 * @param {Object} [vars] - variables to substitute (e.g. {port: 3000})
 * @param {Object} [deps]
 * @param {Function} [deps.spawn]
 * @returns {Promise<{ok: boolean, pid?: number, command?: string, args?: string[], error?: string}>}
 */
async function spawn(commandStr, vars = {}, deps = {}) {
  const parsed = parseCommand(commandStr);
  if (!parsed.ok) {
    log.error("spawn: parse failed", parsed.error);
    return { ok: false, error: parsed.error };
  }

  const tokens = substituteVars(parsed.tokens, vars);
  const command = tokens[0];
  const args = tokens.slice(1);

  const spawnFn = deps.spawn || nodeSpawn;

  let child;
  try {
    child = spawnFn(command, args, {
      detached: true,
      stdio: "ignore",
      // Run in its own process group on Unix so we can kill the tree.
      windowsHide: true,
    });
  } catch (e) {
    // Synchronous failure (invalid args, etc.)
    log.error("spawn threw", e);
    return { ok: false, error: e.message };
  }

  // Async failure (ENOENT, EACCES, etc.) is reported via the 'error' event
  // after the current tick. Wait one event-loop turn so we can return a
  // structured error to the caller instead of letting it bubble out as an
  // unhandled exception.
  const childState = { err: null };
  child.once("error", (e) => {
    childState.err = e;
  });

  await new Promise((resolve) => setImmediate(resolve));

  if (childState.err) {
    log.error("spawn error event", childState.err);
    // Detach the listener so Node doesn't crash on a process we no longer own.
    child.removeAllListeners("error");
    return { ok: false, error: childState.err.message };
  }

  child.unref();

  if (!child.pid) {
    return { ok: false, error: "Spawn returned no PID" };
  }

  log.info(`spawned pid=${child.pid} command=${command} args=${args.join(" ")}`);
  return { ok: true, pid: child.pid, command, args };
}

/**
 * Gracefully kill a process: SIGTERM, wait up to `graceMs`, then SIGKILL.
 * On Windows, SIGTERM is emulated and may not be observed; we fall back to
 * `taskkill /T /F` to ensure the tree is terminated.
 *
 * @param {number} pid
 * @param {Object} [deps]
 * @param {Function} [deps.kill]   - process.kill replacement
 * @param {Function} [deps.exec]   - child_process.exec replacement
 * @param {Function} [deps.sleep]  - () => Promise<void>
 * @param {number}   [deps.graceMs]
 * @param {boolean}  [deps.isAlive] - (pid) => boolean (defaults to process.kill(pid, 0))
 * @returns {Promise<{ok: boolean, escalated: boolean, error?: string}>}
 */
async function kill(pid, deps = {}) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return { ok: false, escalated: false, error: `Invalid pid: ${pid}` };
  }

  const killFn = deps.kill || ((p, sig) => process.kill(p, sig));
  const execFn = deps.exec || nodeExec;
  const sleepFn = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const graceMs = Number.isFinite(deps.graceMs) ? deps.graceMs : KILL_GRACE_MS;
  const isAliveFn =
    deps.isAlive ||
    ((p) => {
      try {
        process.kill(p, 0);
        return true;
      } catch {
        return false;
      }
    });

  // Step 1: SIGTERM (emulated on Windows).
  try {
    killFn(pid, "SIGTERM");
  } catch (e) {
    log.warn(`SIGTERM failed for pid=${pid}: ${e.message}`);
  }

  // Step 2: wait for the process to exit on its own.
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!isAliveFn(pid)) {
      log.info(`pid=${pid} exited gracefully`);
      return { ok: true, escalated: false };
    }
    // eslint-disable-next-line no-await-in-loop
    await sleepFn(100);
  }

  // Step 3: still alive — escalate.
  if (PLATFORM === "win32") {
    await new Promise((resolve) => {
      execFn(`taskkill /T /F /PID ${pid}`, () => resolve());
    });
    log.warn(`pid=${pid} escalated via taskkill /T /F`);
  } else {
    try {
      killFn(pid, "SIGKILL");
    } catch (e) {
      return { ok: false, escalated: true, error: `SIGKILL failed: ${e.message}` };
    }
    log.warn(`pid=${pid} escalated to SIGKILL`);
  }

  // Step 4: confirm exit.
  for (let i = 0; i < 10; i++) {
    if (!isAliveFn(pid)) return { ok: true, escalated: true };
    // eslint-disable-next-line no-await-in-loop
    await sleepFn(50);
  }

  return { ok: false, escalated: true, error: "Process still alive after SIGKILL" };
}

/**
 * Check if a PID is currently alive.
 * @param {number} pid
 * @returns {boolean}
 */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Gracefully stop a process: SIGTERM, wait up to `graceMs`.
 * Unlike `kill`, this does NOT escalate to SIGKILL — that's the caller's
 * decision (e.g. the explicit "Kill" button in the UI).
 *
 * @param {number} pid
 * @param {Object} [deps] - same options as `kill()` minus `escalate` semantics
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function stopByPid(pid, deps = {}) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return { ok: false, error: `Invalid pid: ${pid}` };
  }

  const killFn = deps.kill || ((p, sig) => process.kill(p, sig));
  const sleepFn = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const graceMs = Number.isFinite(deps.graceMs) ? deps.graceMs : KILL_GRACE_MS;
  const isAliveFn =
    deps.isAlive ||
    ((p) => {
      try {
        process.kill(p, 0);
        return true;
      } catch {
        return false;
      }
    });

  try {
    killFn(pid, "SIGTERM");
  } catch (e) {
    return { ok: false, error: `SIGTERM failed: ${e.message}` };
  }

  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!isAliveFn(pid)) {
      log.info(`pid=${pid} stopped gracefully`);
      return { ok: true };
    }
    // eslint-disable-next-line no-await-in-loop
    await sleepFn(100);
  }

  return { ok: false, error: "Process did not exit within grace period" };
}

module.exports = { spawn, kill, stopByPid, isAlive };
