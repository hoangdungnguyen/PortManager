/**
 * Port Manager — Configuration paths and initialization.
 *
 * The preset data file lives at:
 *   $HOME/.vscode/.portmanager/apps.json
 *
 * On first activation the directory and file are created with an empty array
 * so the rest of the extension can safely read it.
 */

const path = require("path");
const fs = require("fs");

const HOME = process.env.HOME || process.env.USERPROFILE || process.cwd();
const DATA_DIR = path.join(HOME, ".vscode", ".portmanager");
const APPS_FILE = path.join(DATA_DIR, "apps.json");
const RUNTIME_FILE = path.join(DATA_DIR, "runtime.json");
const STOPPED_FILE = path.join(DATA_DIR, "stopped.json");

/**
 * Ensure the data directory and apps.json file exist.
 * Creates an empty array as the default content.
 */
function ensureConfig() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(APPS_FILE)) {
      fs.writeFileSync(APPS_FILE, JSON.stringify([], null, 2), "utf-8");
    }
  } catch (e) {
    // Don't throw into the extension host — surface the error to the caller.
    return { ok: false, error: e.message };
  }
  return { ok: true };
}

module.exports = { DATA_DIR, APPS_FILE, RUNTIME_FILE, STOPPED_FILE, ensureConfig };
