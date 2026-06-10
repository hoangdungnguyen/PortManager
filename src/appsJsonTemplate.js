/**
 * Port Manager — apps.json template + notes helpers.
 *
 * apps.json shape (v2, current):
 *   {
 *     "presets": [
 *       {
 *         "label": "...",
 *         "command": "...",
 *         "defaultPort": 1234,
 *         "openBrowser": false,
 *         "notes": ["note 1", "note 2"]   // optional, free-form
 *       },
 *       ...
 *     ]
 *   }
 *
 * apps.json shape (v1, legacy): a flat array of preset objects. Still
 * accepted on read for backward compatibility.
 *
 * Notes are stored **inside each preset** (not as a separate top-level
 * map). When a note is added for a port that has no matching preset,
 * the caller (handleSaveNote in webviewProvider) is responsible for
 * auto-creating a stub preset with `command: "TO ADD"`. This module
 * provides the lower-level helpers; the auto-create logic lives in
 * the webview provider because it needs runtime + port information
 * that this module doesn't have.
 *
 * Pure module: no I/O at import time. All filesystem operations take an
 * injected `fs` and `path`.
 */

const fs = require("fs");
const path = require("path");
const { APPS_FILE } = require("./config");

const MAX_NOTE_LENGTH = 500;

/**
 * Build a preset template object for a given process and port.
 * @param {Object} info
 * @param {string} info.process - Process name (used as default label)
 * @param {number} info.port - The port
 * @param {string} [info.label] - Override label
 * @returns {Object} preset
 */
function buildPresetTemplate(info) {
  const process = (info && info.process) ? String(info.process).trim() : "";
  const port = info && Number.isInteger(info.port) ? info.port : 0;
  const label = (info && info.label) ? String(info.label).trim() : process;
  if (!label) {
    throw new Error("buildPresetTemplate: process or label is required");
  }
  return {
    label,
    command: "TODO: replace with the actual command (e.g. \"" + label + " --port ${port}\")",
    defaultPort: port,
    openBrowser: false,
    note: "",
  };
}

/**
 * Read apps.json and return the raw parsed object. Returns `null` if
 * the file is missing or malformed.
 */
function readAppsFile(deps = {}) {
  const appsFile = deps.appsFile || APPS_FILE;
  const _fs = deps.fs || fs;
  if (!_fs.existsSync(appsFile)) return null;
  try {
    const raw = _fs.readFileSync(appsFile, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (e) {
    return null;
  }
}

/**
 * Write the given object to apps.json atomically.
 */
function writeAppsFile(obj, deps = {}) {
  const appsFile = deps.appsFile || APPS_FILE;
  const _fs = deps.fs || fs;
  try {
    const content = JSON.stringify(obj, null, 2) + "\n";
    const tmp = appsFile + ".tmp";
    _fs.writeFileSync(tmp, content, "utf-8");
    _fs.renameSync(tmp, appsFile);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Read all presets from apps.json. Handles both v1 (flat array) and
 * v2 (object with "presets" key) formats.
 */
function readPresets(deps = {}) {
  const obj = readAppsFile(deps);
  if (!obj) return [];
  const list = Array.isArray(obj) ? obj : (Array.isArray(obj.presets) ? obj.presets : []);
  return list.filter((p) => p && typeof p === "object" && p.label);
}

/**
 * Find a preset by exact label match. Returns null if not found.
 */
function findPresetByLabel(label, deps) {
  if (!label) return null;
  return readPresets(deps).find((p) => p && p.label === label) || null;
}

/**
 * Find a preset whose defaultPort matches the given port.
 */
function findPresetByPort(port, deps) {
  if (!Number.isInteger(port)) return null;
  return readPresets(deps).find(
    (p) => p && Number.isInteger(p.defaultPort) && p.defaultPort === port
  ) || null;
}

/**
 * Insert a new preset into apps.json, preserving existing entries.
 * If a preset with the same label already exists, returns
 * {ok: true, exists: true, existing: <preset>} — caller can decide to
 * open apps.json for editing instead of erroring.
 *
 * Normalizes apps.json to the v2 object form (with "presets" key) on
 * write, even if it was previously a v1 flat array.
 */
function upsertPreset(deps) {
  const appsFile = deps.appsFile || APPS_FILE;
  const preset = deps.preset;
  const _fs = deps.fs || fs;

  if (!preset || !preset.label) {
    return { ok: false, error: "preset with label is required" };
  }

  // Normalize to v2 object form
  const obj = readAppsFile({ appsFile, fs: _fs });
  let doc;
  let existingPresets;
  if (!obj) {
    doc = { presets: [] };
    existingPresets = [];
  } else if (Array.isArray(obj)) {
    doc = { presets: obj };
    existingPresets = obj;
  } else {
    doc = { ...obj };
    existingPresets = Array.isArray(obj.presets) ? obj.presets : [];
  }

  // If a preset with the same label already exists, signal that to
  // the caller instead of failing.
  const duplicate = existingPresets.find((p) => p && p.label === preset.label);
  if (duplicate) {
    return { ok: true, exists: true, existing: duplicate };
  }

  doc.presets = [preset, ...existingPresets];
  const r = writeAppsFile(doc, { appsFile, fs: _fs });
  if (!r.ok) return r;
  return { ok: true };
}

/**
 * Update an existing preset in apps.json by label. The `patch` object
 * is shallow-merged into the existing preset. Returns the updated
 * preset on success, or {ok: false, error} if not found.
 *
 * For the `note` field, the value is normalized to a non-empty string
 * or stripped (set to undefined, then deleted from the preset).
 */
function updatePreset(label, patch, deps = {}) {
  const appsFile = deps.appsFile || APPS_FILE;
  const _fs = deps.fs || fs;
  if (!label) return { ok: false, error: "label is required" };

  const obj = readAppsFile({ appsFile, fs: _fs });
  if (!obj) return { ok: false, error: "apps.json missing" };
  let doc, list;
  if (Array.isArray(obj)) { doc = { presets: obj }; list = obj; }
  else { doc = { ...obj }; list = Array.isArray(obj.presets) ? obj.presets : []; }

  const idx = list.findIndex((p) => p && p.label === label);
  if (idx === -1) return { ok: false, error: "Preset not found: " + label };

  const updated = { ...list[idx], ...patch };
  // Normalize the `note` field: a non-empty trimmed string up to
  // MAX_NOTE_LENGTH, or strip it (delete the key) if empty/missing.
  if ("note" in patch) {
    const v = typeof patch.note === "string" ? patch.note.trim().slice(0, MAX_NOTE_LENGTH) : "";
    if (v.length > 0) {
      updated.note = v;
    } else {
      delete updated.note;
    }
  }
  // Migration helper: if the preset still has the old `notes` array
  // (v1.0.38), collapse it to a single string in `note` (joining with
  // " • " for backward visibility).
  if (Array.isArray(updated.notes) && !("note" in patch)) {
    const joined = updated.notes
      .filter((n) => typeof n === "string" && n.length > 0)
      .map((n) => n.slice(0, MAX_NOTE_LENGTH))
      .join(" • ");
    if (joined.length > 0) {
      updated.note = joined;
    }
    delete updated.notes;
  } else if (Array.isArray(updated.notes)) {
    // patch.note was provided — drop the legacy `notes` array
    delete updated.notes;
  }

  const newList = [...list];
  newList[idx] = updated;
  doc.presets = newList;
  const r = writeAppsFile(doc, { appsFile, fs: _fs });
  if (!r.ok) return r;
  return { ok: true, preset: updated };
}

/**
 * Add a note to the preset that owns the given port. If no preset
 * matches, auto-creates a stub preset with:
 *   - label: <process name from opts.process> or "TO ADD"
 *   - command: "TO ADD"
 *   - defaultPort: <the port>
 *   - openBrowser: false
 *   - note: <text>
 *
 * Note is stored as a single non-empty string. Saving the same text
 * twice is a no-op (de-duped by exact match).
 *
 * Resolution order for finding the preset:
 *   1. Explicit `opts.label`
 *   2. Runtime entry whose port/lastPort matches
 *   3. Preset whose defaultPort matches
 *   4. Auto-create a stub
 *
 * @param {Object} opts
 * @param {string} [opts.label] - Explicit preset label
 * @param {number} [opts.port] - Port to look up a preset for
 * @param {string} [opts.process] - Process name (used as stub label if no preset)
 * @param {Object} [opts.appStore] - AppStore instance (for runtime lookup)
 * @param {string} opts.text - Note text
 * @param {string} [opts.appsFile] - Override apps.json path
 * @param {Object} [opts.fs] - Override fs
 * @returns {{ok: boolean, label?: string, port?: number, text?: string, created?: boolean, error?: string}}
 */
function addNote(opts) {
  const appsFile = opts.appsFile || APPS_FILE;
  const _fs = opts.fs || fs;
  const text = typeof opts.text === "string" ? opts.text.trim().slice(0, MAX_NOTE_LENGTH) : "";
  if (!text) return { ok: false, error: "Note text is required" };

  // Resolve the preset label
  let label = opts.label || null;
  let port = Number.isInteger(opts.port) ? opts.port : parseInt(opts.port, 10);
  if (!Number.isInteger(port)) port = null;

  if (!label && port != null && opts.appStore) {
    const rt = opts.appStore.runtime instanceof Map
      ? opts.appStore.runtime
      : new Map(Object.entries(opts.appStore.runtime || {}));
    for (const [rtLabel, rtVal] of rt.entries()) {
      if (!rtVal) continue;
      const realPort = typeof rtVal.port === "string" && rtVal.port.startsWith("000")
        ? parseInt(rtVal.port.slice(3), 10)
        : (Number.isInteger(rtVal.port) ? rtVal.port : (Number.isInteger(rtVal.lastPort) ? rtVal.lastPort : null));
      if (realPort === port) {
        label = rtLabel;
        break;
      }
    }
  }

  if (!label && port != null) {
    const presets = readPresets({ appsFile, fs: _fs });
    const match = presets.find((p) => p && Number.isInteger(p.defaultPort) && p.defaultPort === port);
    if (match) label = match.label;
  }

  if (!label && port != null) {
    // No preset found — auto-create a stub
    const processName = (typeof opts.process === "string" && opts.process.trim())
      ? opts.process.trim()
      : "";
    const stubLabel = processName || "TO ADD";
    let finalLabel = stubLabel;
    let suffix = 2;
    while (findPresetByLabel(finalLabel, { appsFile, fs: _fs })) {
      finalLabel = stubLabel + " " + suffix;
      suffix++;
    }
    const stub = {
      label: finalLabel,
      command: "TO ADD",
      defaultPort: port,
      openBrowser: false,
      note: text,
    };
    const r = upsertPreset({ preset: stub, appsFile, fs: _fs });
    if (!r.ok) return r;
    return { ok: true, label: finalLabel, port, text, created: true, preset: stub };
  }

  if (!label) {
    return { ok: false, error: "No port provided and no label given" };
  }

  // Set the note on the existing preset (de-dupe by exact text)
  const existing = findPresetByLabel(label, { appsFile, fs: _fs });
  if (!existing) return { ok: false, error: "Preset not found: " + label };
  if (typeof existing.note === "string" && existing.note === text) {
    return { ok: true, label, port, text, created: false };
  }
  const r = updatePreset(label, { note: text }, { appsFile, fs: _fs });
  if (!r.ok) return r;
  return { ok: true, label, port, text, created: true, preset: r.preset };
}

module.exports = {
  buildPresetTemplate,
  upsertPreset,
  readPresets,
  readAppsFile,
  writeAppsFile,
  findPresetByLabel,
  findPresetByPort,
  updatePreset,
  addNote,
};
