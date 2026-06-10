/**
 * Port Manager — Port resolution (auto-bump).
 *
 * Given a desired starting port, return the first free port found by
 * probing sequentially. Probes are limited to `maxOffset` attempts above
 * the start, then falls back to the start (which may already be in use —
 * the caller decides whether to fail or proceed).
 *
 * Pure: depends only on the injected `checkPortFree` probe.
 */

const { MAX_PORT_OFFSET, PORT } = require("./constants");

/**
 * @param {number} start
 * @param {Object} [deps]
 * @param {(port:number)=>Promise<boolean>} [deps.checkPortFree]
 * @param {number} [deps.maxOffset]
 * @returns {Promise<{ok: boolean, port: number, tried: number[], error?: string}>}
 */
async function findFreePort(start, deps = {}) {
  const checkPortFree = deps.checkPortFree || require("./portService").checkPortFree;
  const maxOffset = Number.isFinite(deps.maxOffset) ? deps.maxOffset : MAX_PORT_OFFSET;

  if (!Number.isInteger(start) || start < PORT.MIN || start > PORT.MAX) {
    return { ok: false, port: start, tried: [], error: `Invalid start port: ${start}` };
  }

  const tried = [];
  const limit = Math.min(start + maxOffset, PORT.MAX);

  for (let p = start; p <= limit; p++) {
    tried.push(p);
    // eslint-disable-next-line no-await-in-loop
    const free = await checkPortFree(p);
    if (free) return { ok: true, port: p, tried };
  }

  return {
    ok: false,
    port: start,
    tried,
    error: `No free port found in range [${start}, ${limit}]`,
  };
}

module.exports = { findFreePort };
