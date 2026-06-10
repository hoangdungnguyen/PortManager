/**
 * Port Manager - Constants
 */

const os = require("os");

module.exports = {
  PLATFORM: os.platform(),

  // Timeout values (ms)
  TIMEOUT: {
    COMMAND: 10000,
    KILL: 5000,
  },

  // Port range limits
  PORT: {
    MIN: 1,
    MAX: 65535,
    DEFAULT_SCAN_FROM: 3000,
    DEFAULT_SCAN_TO: 9999,
  },

  // Maximum number of ports to try above defaultPort when auto-bumping.
  MAX_PORT_OFFSET: 10,

  // Synthetic port prefix used to encode a preset's "remembered" port
  // when it is STOPPED/ERROR. The real port number is stored in
  // `lastPort`; the prefixed string goes into `port` so the ghost row
  // can never collide with a live process that later takes over the
  // same real port (e.g. user stops unsloth on 2346, jupyter-notebook
  // then binds 2346). The prefix "000" was chosen so the value can
  // never be a real port (real ports are 1–65535) and so it sorts
  // before normal ports in any default port column.
  STOPPED_PORT_PREFIX: "000",

  // Time to wait between SIGTERM and SIGKILL escalation (ms).
  KILL_GRACE_MS: 3000,

  // Message types for webview communication
  MESSAGE_TYPE: {
    PORTS: "ports",
    KILLED: "killed",
    KILL_ERROR: "killError",
    STOPPED: "stopped",
    STOP_ERROR: "stopError",
    PRESET_STATE: "presetState",
    PRESET_STARTED: "presetStarted",
    PRESET_START_ERROR: "presetStartError",
    APPS_JSON_OPENED: "appsJsonOpened",
    ADDRESS_OPENED: "addressOpened",
    ADDRESS_ERROR: "addressError",
    SCAN_RESULT: "scanResult",
    NOTE_SAVED: "noteSaved",
    NOTE_ERROR: "noteError",
  },

  // Commands from webview
  COMMAND: {
    REFRESH: "refresh",
    KILL: "kill",
    STOP: "stop",
    START_PRESET: "startPreset",
    STOP_PRESET: "stopPreset",
    FORGET_PRESET: "forgetPreset",
    FORGET_STOPPED: "forgetStopped",
    RESUME_STOPPED: "resumeStopped",
    OPEN_ADDRESS: "openAddress",
    PREVIEW_ADDRESS: "previewAddress",
    BULK_KILL: "bulkKill",
    SCAN: "scan",
    OPEN_APPS_JSON: "openAppsJson",
    SAVE_NOTE: "saveNote",
  },

  // Port states
  STATE: {
    LISTEN: "LISTEN",
    FREE: "FREE",
  },

  // Preset runtime lifecycle (distinct from STATE which describes port state).
  RUNTIME_STATE: {
    STOPPED: "STOPPED",
    STARTING: "STARTING",
    RUNNING: "RUNNING",
    STOPPING: "STOPPING",
    ERROR: "ERROR",
  },
};
