/**
 * Port Manager — Preset bridge.
 *
 * Pure functions that link live ports (from getListeningPorts) to presets
 * (from AppStore). The webview needs this mapping to know which rows
 * represent user-managed presets vs. arbitrary processes.
 *
 * No I/O, no side effects, no global state. All inputs are injected.
 */

const { STOPPED_PORT_PREFIX } = require("./constants");

/**
 * Whether a port value is a "synthetic" (remembered) port — i.e. a
 * STOPPED preset's port encoded as `"000<lastPort>"`. These never
 * equal a real listening port, which is what lets the ghost row
 * coexist with a live row at the same real port.
 *
 * @param {*} port
 * @returns {boolean}
 */
function isStoppedPort(port) {
  return typeof port === "string" && port.startsWith(STOPPED_PORT_PREFIX);
}

/**
 * Strip the "000" prefix from a stopped-port value. Returns null if
 * the input doesn't look like a stopped port.
 *
 * @param {string} port
 * @returns {number|null}
 */
function decodeStoppedPort(port) {
  if (!isStoppedPort(port)) return null;
  const n = parseInt(port.slice(STOPPED_PORT_PREFIX.length), 10);
  return Number.isInteger(n) ? n : null;
}

/**
 * Find the preset (if any) that currently owns a port.
 * A preset "owns" a port if its runtime.port matches.
 *
 * Synthetic (stopped) ports never match a real live port, so this
 * function will never return a preset for a stopped port.
 *
 * @param {Object} appStore  - AppStore instance (or stub for tests)
 * @param {number} port
 * @returns {{label: string, state: string, pid: number|null, port: number, lastPort: number|null, defaultPort: number}|null}
 */
function getPresetForPort(appStore, port) {
  if (!appStore || !Number.isInteger(port)) return null;
  const runtime = appStore.runtime instanceof Map
    ? appStore.runtime
    : new Map(Object.entries(appStore.runtime || {}));

  for (const [label, rt] of runtime.entries()) {
    // A preset "owns" a port if either:
    //   - its runtime.port equals the live port (the current actual
    //     port the preset is bound to), OR
    //   - its runtime.lastPort equals the live port (the previous
    //     port it was on — covers the common case where the preset
    //     was restarted and auto-bumped to a different port; the
    //     note + RESUME still apply via the original label)
    // The synthetic "000<port>" form used for stopped presets never
    // matches here, which is what we want: a stopped preset's ghost
    // row will not be linked to a live process.
    const rtPort = typeof rt.port === "number" ? rt.port : null;
    const rtLast = Number.isInteger(rt.lastPort) ? rt.lastPort : null;
    const matches = (rtPort !== null && rtPort === port) || (rtLast !== null && rtLast === port);
    if (rt && matches) {
      const preset = appStore.presets && appStore.presets.find((p) => p.label === label);
      return {
        label,
        state: rt.state,
        pid: rt.pid,
        port: rt.port,
        lastPort: rtLast,
        defaultPort: preset ? preset.defaultPort : rt.port,
        note: preset && typeof preset.note === "string" ? preset.note : "",
      };
    }
  }
  return null;
}

/**
 * Build a "ghost row" for each preset whose runtime is STOPPED/STOPPING/ERROR.
 * These rows persist across refreshes so the user can resume the preset.
 *
 * Ghost rows are displayed with `lastPort` as the visible port number
 * (so the user sees the real port the preset was on before it was
 * stopped), and a `_stopped: true` marker so the renderer can style
 * the row as a ghost. The synthetic "000<port>" `port` field is kept
 * for backward-compatibility (presets that have stale URL references
 * to the old format) but is never used for live-port matching.
 *
 * @param {Object} appStore
 * @param {Array} livePorts - ports from getListeningPorts()
 * @returns {Array} ghost rows in the same shape as live ports, plus a `_ghost: true` flag
 */
function getGhostRows(appStore, livePorts) {
  if (!appStore) return [];
  const livePortsSet = new Set(livePorts.map((p) => p.port));
  const runtime = appStore.runtime instanceof Map
    ? appStore.runtime
    : new Map(Object.entries(appStore.runtime || {}));
  const presets = appStore.presets || [];
  const ghosts = [];

  for (const [label, rt] of runtime.entries()) {
    if (!rt) continue;
    if (rt.state !== "STOPPED" && rt.state !== "STOPPING" && rt.state !== "ERROR") continue;
    if (!rt.port) continue;

    // Determine the real port the preset was on. For new (synthetic)
    // stopped ports this comes from the encoded value; for legacy
    // format, it's the port number itself; failing both, we fall
    // back to lastPort. If even that is missing, skip the ghost.
    const realPort = isStoppedPort(rt.port)
      ? decodeStoppedPort(rt.port)
      : (Number.isInteger(rt.port) ? rt.port : (Number.isInteger(rt.lastPort) ? rt.lastPort : null));
    if (realPort == null) continue;

    // CRITICAL: the user wants the ghost row's port column to show
    // the synthetic "000<port>" form (e.g. "0002346") rather than
    // the real port (2346). This way, when a live process later
    // binds the real port (e.g. jupyter-notebook → 2346), the live
    // row and the ghost row are at DIFFERENT port values in the
    // table and never appear stacked. The ghost is also clearly
    // marked as "stopped" (badge + ram/vram cells) so the user
    // knows it's not a real listening port.
    const displayPort = (typeof rt.port === "string" && isStoppedPort(rt.port))
      ? rt.port                          // already encoded: "0002346"
      : (STOPPED_PORT_PREFIX + realPort); // legacy: re-encode on the fly

    const preset = presets.find((p) => p.label === label);
    if (!preset) continue;

    ghosts.push({
      _ghost: true,
      _stopped: true,
      // Real port for backend message handlers (stoppedTracker.remove,
      // resume handlers, etc.) — they expect a real integer.
      port: realPort,
      // Synthetic "000<port>" for the webview's port column display.
      // This is what the user actually sees in the table, and it's
      // what makes the ghost row visually distinct from any live
      // row at the same real port.
      displayPort: displayPort,
      pid: null,
      process: preset.label,
      state: "LISTEN", // visual: shown as in-use
      address: "http" + (realPort === 443 || realPort === 8443 || realPort === 9443 ? "s" : "") +
        "://localhost:" + realPort,
      ram: "-",
      vram: "-",
      preset: {
        label,
        state: rt.state,
        pid: null,
        port: realPort,
        lastPort: Number.isInteger(rt.lastPort) ? rt.lastPort : realPort,
        defaultPort: preset.defaultPort,
        note: typeof preset.note === "string" ? preset.note : "",
      },
    });
  }
  return ghosts;
}

module.exports = { getPresetForPort, getGhostRows };
