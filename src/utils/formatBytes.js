/**
 * Format a kilobyte value as a human-readable memory string.
 * Pure function: no side effects, no dependencies.
 *
 * @param {number} kb - Value in kilobytes
 * @returns {string} e.g. "128 MB" / "1.5 GB"
 */
function formatBytes(kb) {
  if (!Number.isFinite(kb) || kb < 0) return "-";
  if (kb >= 1048576) return `${(kb / 1048576).toFixed(1)} GB`;
  return `${(kb / 1024).toFixed(0)} MB`;
}

module.exports = { formatBytes };
