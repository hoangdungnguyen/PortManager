/**
 * Port Manager - Port Detection & Management Service
 */

const { execSync } = require("child_process");
const net = require("net");
const { PLATFORM, TIMEOUT, STATE } = require("./constants");

// Windows has no reliable built-in RAM/VRAM probe that doesn't require WMI/PS.
const SUPPORTS_MEMORY_PROBE = PLATFORM === "darwin" || PLATFORM === "linux";

// Well-known TLS ports — for these, buildAddress uses https://. For
// everything else, http://. Users can override by editing apps.json
// or by adding a custom protocol map.
const TLS_PORTS = new Set([443, 8443, 9443]);

/**
 * Build a clickable URL for the given port. Defaults to http://localhost:PORT.
 * Uses https:// for ports in the TLS_PORTS set.
 * @param {number} port
 * @returns {string}
 */
function buildAddress(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return "";
  const protocol = TLS_PORTS.has(port) ? "https" : "http";
  return protocol + "://localhost:" + port;
}

/**
 * Get all listening ports on the system, enriched with RAM and VRAM usage.
 * @returns {Array<{port: number, pid: number|null, process: string, state: string, ram: string, vram: string}>}
 */
function getListeningPorts() {
  let ports = [];

  if (PLATFORM === "darwin" || PLATFORM === "linux") {
    ports = getPortsUnix();
  } else if (PLATFORM === "win32") {
    ports = getPortsWindows();
  }

  // Cache nvidia-smi output once per refresh — not per PID.
  const vramByPid = SUPPORTS_MEMORY_PROBE ? getVramMap() : new Map();
  // Batch-fetch RAM for all PIDs in a single `ps` call. Was previously
  // one spawn per port (O(n) spawns); now 1 spawn total. Big win on
  // hosts with many listening ports.
  const pids = ports.map((p) => p.pid).filter(Number.isInteger);
  const ramByPid = SUPPORTS_MEMORY_PROBE ? getRamMap(pids) : new Map();

  return ports.map((p) => ({
    ...p,
    state: STATE.LISTEN,
    address: buildAddress(p.port),
    ram: SUPPORTS_MEMORY_PROBE ? getRamUsage(p.pid, ramByPid) : "-",
    vram: vramByPid.get(p.pid) || "-",
  }));
}

/**
 * Get listening ports on Unix-like systems (macOS, Linux)
 * @returns {Array<{port: number, pid: number, process: string}>}
 */
function getPortsUnix() {
  const ports = [];

  // Try lsof first (works well on macOS)
  if (tryLsof(ports)) {
    return sortByPort(ports);
  }

  // Fallback to ss (common on Linux)
  trySs(ports);
  return sortByPort(ports);
}

/**
 * Try to get ports using lsof command
 * @param {Array} ports - Array to populate with port info
 * @returns {boolean} - True if successful
 */
function tryLsof(ports) {
  try {
    const output = execSync("lsof -iTCP -sTCP:LISTEN -nP 2>/dev/null || true", {
      encoding: "utf-8",
      timeout: TIMEOUT.COMMAND,
    });

    const seen = new Set();
    const lines = output.split("\n").slice(1); // Skip header

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 9) continue;

      const process = parts[0];
      const pid = parseInt(parts[1], 10);
      const addressField = parts[8] || "";
      const portMatch = addressField.match(/:(\d+)$/);

      if (!portMatch) continue;

      const port = parseInt(portMatch[1], 10);
      if (seen.has(port)) continue;

      seen.add(port);
      ports.push({ port, pid, process });
    }

    return ports.length > 0;
  } catch {
    return false;
  }
}

/**
 * Try to get ports using ss command (Linux)
 * @param {Array} ports - Array to populate with port info
 */
function trySs(ports) {
  try {
    const output = execSync("ss -tlnp 2>/dev/null || true", {
      encoding: "utf-8",
      timeout: TIMEOUT.COMMAND,
    });

    const lines = output.split("\n").slice(1); // Skip header

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5) continue;

      const addressField = parts[3] || "";
      const portMatch = addressField.match(/:(\d+)$/);
      if (!portMatch) continue;

      const port = parseInt(portMatch[1], 10);
      const processField = parts[6] || "";
      const pidMatch = processField.match(/pid=(\d+)/);
      const nameMatch = processField.match(/\("([^"]+)"/);

      ports.push({
        port,
        pid: pidMatch ? parseInt(pidMatch[1], 10) : null,
        process: nameMatch ? nameMatch[1] : "unknown",
      });
    }
  } catch {
    // Silently fail - no ports available
  }
}

/**
 * Get listening ports on Windows
 * @returns {Array<{port: number, pid: number, process: string}>}
 */
function getPortsWindows() {
  const ports = [];

  try {
    const output = execSync("netstat -ano -p TCP", {
      encoding: "utf-8",
      timeout: TIMEOUT.COMMAND,
    });

    const pidToName = getPidToNameMap();
    const seen = new Set();

    for (const line of output.split("\n")) {
      if (!line.includes("LISTENING")) continue;

      const parts = line.trim().split(/\s+/);
      const addressField = parts[1] || "";
      const portMatch = addressField.match(/:(\d+)$/);

      if (!portMatch) continue;

      const port = parseInt(portMatch[1], 10);
      if (seen.has(port)) continue;

      seen.add(port);
      const pid = parseInt(parts[parts.length - 1], 10);

      ports.push({
        port,
        pid,
        process: pidToName[String(pid)] || `PID:${pid}`,
      });
    }
  } catch {
    // Silently fail
  }

  return sortByPort(ports);
}

/**
 * Get PID to process name mapping on Windows
 * @returns {Object<string, string>}
 */
function getPidToNameMap() {
  const pidToName = {};

  try {
    const tasks = execSync("tasklist /fo csv /nh", {
      encoding: "utf-8",
      timeout: TIMEOUT.COMMAND,
    });

    for (const line of tasks.split("\n")) {
      const match = line.match(/"([^"]+)","(\d+)"/);
      if (match) {
        pidToName[match[2]] = match[1];
      }
    }
  } catch {
    // Silently fail
  }

  return pidToName;
}

/**
 * Kill a process by PID
 * @param {number} pid - Process ID to kill
 * @throws {Error} If kill fails
 */
function killByPid(pid) {
  const command =
    PLATFORM === "win32" ? `taskkill /F /PID ${pid}` : `kill -9 ${pid}`;

  execSync(command, { timeout: TIMEOUT.KILL });
}

/**
 * Check if a port is free (not in use)
 * @param {number} port - Port number to check
 * @returns {Promise<boolean>} - True if port is free
 */
function checkPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close();
      resolve(true);
    });

    server.listen(port, "127.0.0.1");
  });
}

/**
 * Sort ports array by port number
 * @param {Array} ports
 * @returns {Array}
 */
function sortByPort(ports) {
  return ports.sort((a, b) => a.port - b.port);
}

/**
 * Format a kilobyte value into a human-readable string.
 * @param {number} kb
 * @returns {string}
 */
function formatKb(kb) {
  if (kb > 1048576) return `${(kb / 1048576).toFixed(1)} GB`;
  return `${(kb / 1024).toFixed(0)} MB`;
}

/**
 * Build a PID → RSS (KB) map from a single `ps` call, instead of
 * spawning one `ps` per PID. The single call passes all PIDs as a
 * comma-separated list to `-p`, which is dramatically cheaper when
 * the panel has many rows.
 *
 * Returns an empty Map if the call fails or on Windows.
 * @param {Array<number>} pids
 * @returns {Map<number, number>} pid → KB
 */
function getRamMap(pids) {
  const map = new Map();
  if (!Array.isArray(pids) || pids.length === 0) return map;
  if (process.platform === "win32") {
    // Fall back to the per-PID lookup on Windows (no batched -p syntax
    // equivalent is reliable across Windows versions).
    for (const pid of pids) {
      try {
        const out = execSync(
          `tasklist /FI "PID eq ${pid}" /NH /FO CSV 2>NUL`,
          { encoding: "utf-8", timeout: 2000 }
        );
        const m = out.match(/"[^"]+"\s+(\d+)\s/);
        if (m) map.set(pid, parseInt(m[1], 10) * 1024); // tasklist reports bytes
      } catch { /* ignore */ }
    }
    return map;
  }
  try {
    const pidList = pids.filter(Number.isInteger).join(",");
    if (!pidList) return map;
    const output = execSync(
      `ps -o pid=,rss= -p ${pidList} 2>/dev/null || true`,
      { encoding: "utf-8", timeout: 2000 }
    );
    for (const line of output.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Output is whitespace-separated: "  12345  65432"
      const m = trimmed.match(/^(\d+)\s+(\d+)/);
      if (!m) continue;
      const pid = parseInt(m[1], 10);
      const kb = parseInt(m[2], 10);
      if (Number.isInteger(pid) && Number.isInteger(kb)) {
        map.set(pid, kb);
      }
    }
  } catch {
    // ps not available — leave map empty.
  }
  return map;
}

/**
 * Get RAM usage (Resident Set Size) for a single PID.
 * Prefer the batched `getRamMap` for many PIDs.
 * @param {number|null} pid
 * @param {Map<number, number>} [ramMap] - optional pre-built map
 * @returns {string} e.g. "128 MB" or "-"
 */
function getRamUsage(pid, ramMap) {
  if (!Number.isInteger(pid) || pid <= 0) return "-";
  if (ramMap && ramMap.has(pid)) {
    return formatKb(ramMap.get(pid));
  }
  // Fallback: spawn a single ps call.
  try {
    const output = execSync(`ps -o rss= -p ${pid} 2>/dev/null || true`, {
      encoding: "utf-8",
      timeout: 2000,
    }).trim();
    if (!output) return "-";
    const kb = parseInt(output, 10);
    if (isNaN(kb)) return "-";
    return formatKb(kb);
  } catch {
    return "-";
  }
}

/**
 * Build a PID → VRAM string map from a single `nvidia-smi` call.
 * Returns an empty Map if nvidia-smi is missing or fails.
 * @returns {Map<number, string>}
 */
function getVramMap() {
  const map = new Map();
  try {
    const output = execSync(
      "nvidia-smi --query-compute-apps=pid,used_memory --format=csv,noheader 2>/dev/null || true",
      { encoding: "utf-8", timeout: 2000 }
    );
    if (!output) return map;

    for (const line of output.trim().split("\n")) {
      const parts = line.split(",").map((s) => s.trim());
      if (parts.length < 2) continue;

      const pid = parseInt(parts[0], 10);
      const memStr = parts[1].replace("MiB", "").trim();
      const mb = parseInt(memStr, 10);
      if (isNaN(pid) || isNaN(mb)) continue;

      map.set(pid, mb > 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`);
    }
  } catch {
    // nvidia-smi not available — leave map empty.
  }
  return map;
}

/**
 * Look up the PID currently listening on a given port, by re-running
 * the scanner. Returns null if no process is listening, or if the PID
 * cannot be determined (e.g. on Windows for system-owned ports).
 * @param {number} port
 * @returns {number|null}
 */
function getPidForPort(port) {
  if (!Number.isInteger(port) || port <= 0) return null;
  const ports = getListeningPorts();
  const found = ports.find((p) => p.port === port);
  return found && Number.isInteger(found.pid) ? found.pid : null;
}

module.exports = {
  getListeningPorts,
  killByPid,
  checkPortFree,
  getRamUsage,
  getRamMap,
  getVramMap,
  getPidForPort,
  buildAddress,
};
