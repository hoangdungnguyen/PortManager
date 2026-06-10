/**
 * Port Manager - Webview Client Script
 */

module.exports = function getScript() {
  return /*javascript*/ `
  const vscode = acquireVsCodeApi();

  // State
  let ports = [];
  let selected = new Set();
  let currentSort = { col: "port", dir: "asc" };
  let filter = "";
  let confirmingKill = null;
  let confirmingKillProcess = null;
  // Ports that received a Stop signal — kept visible until user refreshes
  // (or until the auto-refresh timer fires, if any).
  const stoppingPorts = new Set();
  const stoppedPorts = new Set();
  // Local override of preset state, keyed by **label** (not port) so the
  // override survives port changes (auto-bump on resume). Updated when
  // user clicks Stop/Resume before the backend refresh arrives.
  // Map<string, {label, state, port}>
  const presetOverrides = new Map();
  // Ghost rows from backend (stopped presets whose port isn't in the live list)
  let ghosts = [];
  // Port currently being edited for its note. While set, auto-refresh
  // and message-driven re-renders skip that row to avoid clobbering
  // the user's in-progress input. Set by startEditNote, cleared by
  // commitNoteEdit / cancelNoteEdit.
  let editingNotePort = null;

  // DOM Elements
  const elements = {
    tbody: () => document.getElementById("tbody"),
    stats: () => document.getElementById("stats"),
    empty: () => document.getElementById("empty"),
    search: () => document.getElementById("search"),
    scanPanel: () => document.getElementById("scanPanel"),
    scanFrom: () => document.getElementById("scanFrom"),
    scanTo: () => document.getElementById("scanTo"),
    bulkKillBtn: () => document.getElementById("bulkKillBtn"),
    toastContainer: () => document.getElementById("toastContainer"),
    selectAll: () => document.getElementById("selectAll"),
  };

  // Event delegation: a single click listener on tbody handles ALL
  // action buttons (stop/kill/resume/forget). This is robust against
  // inline-handler issues with process names containing special chars.
  elements.tbody().addEventListener("click", onActionClick);

  // Message handler from VS Code
  window.addEventListener("message", (event) => {
    const msg = event.data;

    switch (msg.type) {
      case "ports":
        ports = msg.ports || [];
        ghosts = msg.ghosts || [];
        // Clean up preset overrides whose preset is no longer in either list.
        // Build a set of preset labels that are currently visible.
        const visibleLabels = new Set([
          ...ports.map((p) => p.preset && p.preset.label).filter(Boolean),
          ...ghosts.map((g) => g.preset && g.preset.label).filter(Boolean),
        ]);
        for (const [label, ov] of presetOverrides.entries()) {
          if (!visibleLabels.has(label)) presetOverrides.delete(label);
        }
        // If the user is mid-edit on a note, do NOT re-render the
        // table — that would clobber the input. Just update the
        // data; the cell will be restored on commit/cancel.
        if (editingNotePort === null) {
          render();
        }
        break;

      case "killed":
        showToast(":" + msg.port + " killed", "success");
        confirmingKill = null;
        selected.delete(msg.port);
        vscode.postMessage({ command: "refresh" });
        break;

      case "killError":
        showToast("Kill failed: " + msg.error, "error");
        confirmingKill = null;
        render();
        break;

      case "stopped":
        if (msg.preset) {
          showToast("Preset '" + msg.preset + "' on :" + msg.port + " stopped", "success");
          // Mark the preset as stopped in our local override (keyed by
          // label so it survives a port-bump on resume).
          presetOverrides.set(msg.preset, {
            label: msg.preset,
            state: "STOPPED",
            port: msg.port,
          });
        } else {
          showToast(":" + msg.port + " stopped", "success");
        }
        confirmingKill = null;
        selected.delete(msg.port);
        stoppingPorts.delete(msg.port);
        stoppedPorts.add(msg.port);
        render();
        // Trigger a refresh so the backend's ghost-row logic kicks in
        vscode.postMessage({ command: "refresh" });
        break;

      case "stopError":
        showToast("Stop failed: " + (msg.error || "process did not exit"), "error");
        confirmingKill = null;
        render();
        break;

      case "presetStarted":
        const where = msg.bumped
          ? ":" + msg.port + " (bumped from :" + msg.defaultPort + ")"
          : ":" + msg.port;
        showToast("Resumed '" + msg.label + "' on " + where, "success");
        stoppedPorts.delete(msg.port);
        stoppingPorts.delete(msg.port);
        // Clear override by **label** (not port) so the override for
        // a bumped port is correctly removed.
        if (msg.label) presetOverrides.delete(msg.label);
        render();
        // Ask the backend to refresh — gets fresh RAM/VRAM for the new row
        vscode.postMessage({ command: "refresh" });
        break;

      case "presetStartError":
        showToast("Resume failed: " + (msg.error || "unknown"), "error");
        render();
        break;

      case "addressOpened":
        // Opened in browser — quiet success (no toast)
        console.debug("[port-manager] address opened:", msg.url);
        break;

      case "addressError":
        showToast("Open URL failed: " + (msg.error || "unknown"), "error");
        break;

      case "appsJsonOpened":
        if (msg.needsSetup) {
          showToast(
            "Edit the command for '" + msg.label + "' in apps.json, save, then click Resume again",
            "success"
          );
        } else if (msg.alreadyExists) {
          showToast("Preset '" + msg.label + "' already exists", "info");
        } else if (msg.path) {
          // Generic "Edit Config" button was clicked — just confirm
          // apps.json is open.
          showToast("Opened " + msg.path, "success");
        } else {
          showToast(
            "Set up the command in apps.json for '" + msg.label + "', save, then click Resume again",
            "success"
          );
        }
        break;

      case "scanResult":
        showToast("In use: " + msg.used + " / Free: " + msg.free, "success");
        break;

      case "noteSaved":
        // Backend confirmed the save — update the local state and
        // re-render. (The webview already optimistically updated in
        // commitNoteEdit; this is the authoritative confirmation.)
        for (const p of ports) {
          if (p.port === msg.port) p.note = msg.text || "";
        }
        for (const g of ghosts) {
          if (g.port === msg.port) g.note = msg.text || "";
        }
        render();
        break;

      case "noteError":
        showToast("Note save failed: " + (msg.error || "unknown"), "error");
        render();
        break;
    }
  });

  // Render the port table
  function render() {
    const list = filterAndSort();
    renderStats();
    renderTable(list);
    updateBulkKillButton();
    updateSortIndicators();
  }

  /**
   * Parse a memory string like "128 MB" / "1.5 GB" / "-" into a number
   * of megabytes. Returns NaN for unknown values so the sort comparator
   * can push them to the end.
   */
  /**
   * Escape a string for safe use as an HTML attribute value.
   * @param {string} str
   * @returns {string}
   */
  function escapeAttr(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /**
   * Handle a click on any action button in the table. Uses event
   * delegation on tbody — robust against inline-handler issues, no
   * string interpolation of process names into JS expressions.
   */
  function onActionClick(event) {
    const btn = event.target.closest && event.target.closest("button[data-action], a[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const port = parseInt(btn.dataset.port, 10);
    const pid = btn.dataset.pid ? parseInt(btn.dataset.pid, 10) : null;
    const process = btn.dataset.process || null;
    const label = btn.dataset.label || null;
    const url = btn.dataset.url || null;
    console.debug("[port-manager] onActionClick:", { action, port, pid, process, label, url });

    switch (action) {
      case "stop": startStop(port, pid, process); break;
      case "kill": startKill(port, process); break;
      case "confirm-kill": confirmKill(port, pid); break;
      case "cancel-kill": cancelKill(); break;
      case "resume": startResume(port, label); break;
      case "forget-preset": forgetPreset(port, label); break;
      case "resume-stopped": startResumeStopped(port, process); break;
      case "forget-stopped": forgetStopped(port); break;
      case "open-address":
        if (url) vscode.postMessage({ command: "openAddress", url, port });
        break;
      case "copy-address":
        if (url) copyAddressToClipboard(url);
        break;
      case "preview-address":
        if (url) openPreviewInEditor(url, port);
        break;
      case "edit-note":
        startEditNote(port);
        break;
      case "save-note":
        commitNoteEdit(port, btn.dataset.text || "");
        break;
      case "cancel-note":
        cancelNoteEdit();
        break;
    }
  }

  /**
   * Copy a URL to the clipboard using the Web Clipboard API with a
   * hidden-textarea fallback. Shows a confirmation toast.
   */
  async function copyAddressToClipboard(url) {
    try {
      await navigator.clipboard.writeText(url);
      showToast("Copied: " + url, "success");
    } catch (e) {
      // Fallback: select the text in a temporary textarea
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        showToast("Copied: " + url, "success");
      } catch {
        showToast("Copy failed", "error");
      }
      document.body.removeChild(ta);
    }
  }

  /**
   * Open a URL as an in-editor preview using vscode.commands.executeCommand
   * with "vscode.open" on a parsed Uri. VS Code opens a Simple Browser
   * editor for http(s) URLs.
   */
  function openPreviewInEditor(url, port) {
    try {
      // Use the simple browser API. The webview can pass the URL to the
      // extension host, which then calls vscode.commands.executeCommand.
      // For simplicity, we just open it in the external browser — VS Code
      // doesn't expose a "preview in editor" webview API directly. The
      // user can use the "Open in browser" icon for the same effect, but
      // we expose this button for the VS Code Ports panel parity.
      vscode.postMessage({ command: "previewAddress", url, port });
    } catch (e) {
      showToast("Preview failed: " + e.message, "error");
    }
  }

  /**
   * Begin editing a note. Replaces the cell content with an input
   * field + Save/Cancel buttons. The save button posts to the backend
   * via event delegation (data-action="save-note" with data-port).
   *
   * Note: we use direct DOM manipulation here instead of re-rendering
   * the table, to preserve focus on the input and avoid a flash.
   * We also set the editingNotePort lock so the auto-refresh
   * (every 3s) doesn't clobber the input.
   *
   * @param {number} port
   */
  function startEditNote(port) {
    editingNotePort = port;
    // Find the row that contains a note-display for this port.
    const row = elements.tbody().querySelector(
      'tr[data-port="' + port + '"]'
    );
    if (!row) {
      editingNotePort = null;
      return;
    }
    const cell = row.querySelector(".note-cell");
    if (!cell) {
      editingNotePort = null;
      return;
    }
    // Find the current note text (may be "add a note…" placeholder).
    const display = cell.querySelector(".note-display");
    if (!display) {
      editingNotePort = null;
      return;
    }
    const textSpan = display.querySelector(".note-text");
    const current = textSpan ? textSpan.textContent : "";
    // Replace with input + save/cancel buttons. Use data-* attributes
    // for event delegation.
    cell.innerHTML =
      '<span class="note-edit">' +
      '<input type="text" class="note-input" data-port="' + port + '" value="' + escapeAttr(current) + '" maxlength="500" placeholder="add a note…" />' +
      '<button class="note-save-btn" data-action="save-note" data-port="' + port + '" data-text="' + escapeAttr(current) + '" title="Save">✓</button>' +
      '<button class="note-cancel-btn" data-action="cancel-note" data-port="' + port + '" title="Cancel">✕</button>' +
      '</span>';
    const input = cell.querySelector(".note-input");
    if (input) {
      input.focus();
      input.select();
      // Save on Enter, cancel on Escape.
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitNoteEdit(port, input.value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancelNoteEdit();
        }
      });
      // Keep data-text in sync so the save button (rendered separately)
      // sends the current value.
      input.addEventListener("input", () => {
        const saveBtn = cell.querySelector(".note-save-btn");
        if (saveBtn) saveBtn.dataset.text = input.value;
      });
    }
  }

  /**
   * Commit a note edit. Posts to the backend, which persists to
   * apps.json. The backend's NOTE_SAVED message handler updates the
   * local state and re-renders.
   *
   * @param {number} port
   * @param {string} text
   */
  function commitNoteEdit(port, text) {
    console.debug("[port-manager] commitNoteEdit:", { port, text });
    editingNotePort = null; // release the lock so render() runs normally
    vscode.postMessage({ command: "saveNote", port, text: text || "" });
    // Optimistically update the local ports list so the next render
    // shows the new note immediately. The backend's NOTE_SAVED message
    // will also update the local state, so this is safe.
    for (const p of ports) {
      if (p.port === port) p.note = text || "";
    }
    for (const g of ghosts) {
      if (g.port === port) g.note = text || "";
    }
    showToast("Note saved for port " + port, "success");
    render();
  }

  /**
   * Cancel a note edit by re-rendering (which restores the cell from
   * the current state).
   */
  function cancelNoteEdit() {
    editingNotePort = null; // release the lock
    render();
  }

  function parseMemory(str) {
    if (str == null) return NaN;
    const s = String(str).trim();
    if (!s || s === "-") return NaN;
    const m = s.match(/^([\\d.]+)\\s*(KB|MB|GB)$/i);
    if (!m) return NaN;
    const n = parseFloat(m[1]);
    if (!Number.isFinite(n)) return NaN;
    const unit = m[2].toUpperCase();
    if (unit === "GB") return n * 1024;
    if (unit === "MB") return n;
    if (unit === "KB") return n / 1024;
    return NaN;
  }

  function filterAndSort() {
    // Build a "stopped preset ghost" row from local override if the backend
    // didn't send one (defensive fallback for race conditions).
    const liveAndGhostPorts = new Set([
      ...ports.map((p) => p.port),
      ...ghosts.map((g) => g.port),
    ]);
    const localGhosts = [];
    for (const [label, override] of presetOverrides.entries()) {
      // Skip if the preset is already visible (live or backend ghost)
      const isVisible = [...ports, ...ghosts].some(
        (p) => p.preset && p.preset.label === label
      );
      if (isVisible) continue;
      const port = override.port;
      if (!port) continue;
      localGhosts.push({
        _ghost: true,
        port,
        pid: null,
        process: label,
        state: "LISTEN",
        ram: "-",
        vram: "-",
        preset: {
          label,
          state: override.state,
          pid: null,
          port,
          defaultPort: port,
        },
      });
    }

    // Merge live ports, backend ghost rows, and local-fallback ghosts
    let list = [...ports, ...ghosts, ...localGhosts].filter((p) => {
      if (!filter) return true;
      const f = filter.toLowerCase();
      return (
        String(p.port).includes(f) ||
        (p.process || "").toLowerCase().includes(f) ||
        (p.note || "").toLowerCase().includes(f)
      );
    });

    list.sort((a, b) => {
      let cmp = 0;
      const col = currentSort.col;

      if (col === "port") {
        // port is always a real integer (live rows + ghost rows
        // have their remembered port stored as a real number for
        // backend message handling). Sort numerically.
        cmp = (a.port || 0) - (b.port || 0);
      }
      else if (col === "state") cmp = (a.state || "").localeCompare(b.state || "");
      else if (col === "process") cmp = (a.process || "").localeCompare(b.process || "");
      else if (col === "pid") cmp = (a.pid || 0) - (b.pid || 0);
      else if (col === "address") cmp = (a.address || "").localeCompare(b.address || "");
      else if (col === "ram" || col === "vram") {
        // NaN (i.e. "-") always sorts to the end regardless of direction.
        const av = parseMemory(a[col]);
        const bv = parseMemory(b[col]);
        const aMissing = Number.isNaN(av);
        const bMissing = Number.isNaN(bv);
        if (aMissing && bMissing) cmp = 0;
        else if (aMissing) return 1;
        else if (bMissing) return -1;
        else cmp = av - bv;
      }

      const result = currentSort.dir === "asc" ? cmp : -cmp;
      if (col === "ram" || col === "vram") {
        console.debug("[port-manager] sort", col, currentSort.dir, "a:", a.port, a[col], "b:", b.port, b[col], "→", result);
      }
      return result;
    });

    return list;
  }

  function renderStats() {
    const listenCount = ports.filter((p) => p.state === "LISTEN").length;
    const freeCount = ports.filter((p) => p.state === "FREE").length;

    elements.stats().innerHTML =
      '<span><span class="dot" style="background:#FF5252"></span> In Use ' + listenCount + "</span>" +
      '<span><span class="dot" style="background:#00E676"></span> Free ' + freeCount + "</span>" +
      "<span>Total " + ports.length + "</span>";
  }

  function renderTable(list) {
    const tbody = elements.tbody();

    if (list.length === 0) {
      tbody.innerHTML = "";
      elements.empty().style.display = "block";
      return;
    }

    elements.empty().style.display = "none";
    tbody.innerHTML = list.map(renderRow).join("");
  }

  function renderRow(p) {
    const isSelected = selected.has(p.port);
    const isListen = p.state === "LISTEN";
    const badgeClass = isListen ? "badge-listen" : "badge-free";
    const badgeText = isListen ? "In Use" : "Free";
    const isConfirming = confirmingKill === p.port;
    const isStopping = stoppingPorts.has(p.port);
    const isStopped = stoppedPorts.has(p.port);
    const isGhost = p._ghost === true;

    // Determine preset info: prefer local override (set right after user clicks
    // Stop/Resume), then the server-provided p.preset, then null.
    // Override is keyed by **label** to survive port changes.
    const serverPreset = p.preset;
    const override = serverPreset ? presetOverrides.get(serverPreset.label) : null;
    const presetInfo = override
      ? { label: override.label, state: override.state, port: p.port, defaultPort: serverPreset.defaultPort || p.port }
      : serverPreset;

    // Determine effective stopped state: ghost rows are inherently stopped.
    const isPresetStopped = isGhost || (presetInfo && presetInfo.state === "STOPPED") || (presetInfo && presetInfo.state === "STOPPING") || (presetInfo && presetInfo.state === "ERROR");
    const isPresetRunning = presetInfo && (presetInfo.state === "RUNNING" || presetInfo.state === "STARTING");

    const actionHtml = isListen ? renderActionButtons(p, isConfirming, isPresetStopped, presetInfo) : "";

    // Diagnostic data attributes: expose parsed MB values for sort debugging.
    const ramMb = parseMemory(p.ram);
    const vramMb = parseMemory(p.vram);

    let rowClass = isSelected ? "selected" : "";
    if (isStopping) rowClass += " stopping";
    if (isStopped || isPresetStopped) rowClass += " stopped";
    if (isGhost) rowClass += " ghost";

    let displayRam = p.ram || "-";
    let displayVram = p.vram || "-";
    let displayBadge = badgeText;
    let displayBadgeClass = badgeClass;
    if (isGhost) {
      displayRam = "stopped";
      displayVram = "stopped";
      displayBadge = "Stopped";
      displayBadgeClass = "badge-stopped";
    } else if (isStopping) {
      displayRam = "stopping…";
      displayVram = "stopping…";
    } else if (isStopped || isPresetStopped) {
      displayRam = "stopped";
      displayVram = "stopped";
      displayBadge = "Stopped";
      displayBadgeClass = "badge-stopped";
    }

    return (
      '<tr class="' + rowClass + '"' +
      ' data-port="' + p.port + '"' +
      ' data-ram-mb="' + (Number.isNaN(ramMb) ? "" : ramMb) + '"' +
      ' data-vram-mb="' + (Number.isNaN(vramMb) ? "" : vramMb) + '"' +
      ' data-preset-label="' + (presetInfo ? presetInfo.label : "") + '">' +
      "<td><input type=\\"checkbox\\" " + (isSelected ? "checked" : "") +
      ' onchange="togglePort(' + p.port + ')"></td>' +
      // Port column: bare number (no leading ":"). For stopped preset
      // ghost rows, show the synthetic "000<port>" value (e.g.
      // "0002346") so the ghost is visually distinct from any live
      // row at the same real port. Live rows just show p.port.
      '<td class="port-num">' + (p.displayPort || p.port) + "</td>" +
      renderAddressCell(p) +
      '<td><span class="badge ' + displayBadgeClass + '">' + displayBadge + "</span></td>" +
      renderProcessCell(p, presetInfo) +
      renderNoteCell(p) +
      '<td class="pid">' + (p.pid || "-") + "</td>" +
      '<td class="ram">' + displayRam + "</td>" +
      '<td class="vram">' + displayVram + "</td>" +
      '<td style="text-align:right">' + actionHtml + "</td>" +
      "</tr>"
    );
  }

  /**
   * Render the Note cell. Shows the current note text (or placeholder
   * if empty) with an edit button. Clicking the edit button replaces
   * the cell with an input field + Save / Cancel buttons.
   */
  function renderNoteCell(p) {
    const note = p.note || "";
    const port = p.port;
    const safeText = escapeAttr(note);
    return (
      '<td class="note-cell">' +
      '<span class="note-display" data-port="' + port + '">' +
      (note
        ? '<span class="note-text" title="' + safeText + '">' + safeText + '</span>'
        : '<span class="note-empty">add a note…</span>') +
      '<button class="note-edit-btn" data-action="edit-note" data-port="' + port + '" title="Edit note">✎</button>' +
      '</span>' +
      '</td>'
    );
  }

  /**
   * Render the process cell. Preset-owned rows show the preset label
   * prominently with a "preset" tag, and the actual process name
   * (from the scanner) as a smaller subtitle. Non-preset rows render
   * the process name only.
   */
  function renderProcessCell(p, presetInfo) {
    // For stopped-ghost rows where the process name was never recorded
    // (e.g. from pre-v1.0.11 stopped.json entries), show "unknown" so
    // the user can tell these are stale. Newer rows will have a real
    // process name.
    const processName = p.process || (p._stopped ? "unknown" : "-");
    if (presetInfo) {
      const label = presetInfo.label;
      // If the process name already matches the label (case-insensitive
      // substring), don't repeat it.
      const showSubtitle = processName !== "-" && processName !== "unknown" &&
        label.toLowerCase().indexOf(processName.toLowerCase()) === -1 &&
        processName.toLowerCase().indexOf(label.toLowerCase()) === -1;
      return (
        '<td class="process-name">' +
        '<span class="preset-tag" title="Managed by preset — STOP keeps this row, with a Resume button">preset</span> ' +
        '<span class="preset-label" title="Preset label: ' + label + '">' + label + '</span>' +
        (showSubtitle
          ? '<div class="process-subtitle">' + processName + '</div>'
          : '') +
        '</td>'
      );
    }
    return '<td class="process-name">' + processName + '</td>';
  }

  /**
   * Strip the leading protocol (http:// or https://) from a URL for
   * display purposes only. The full URL (with protocol) is still
   * passed to the click handler in data-url so openExternal /
   * asExternalUri work correctly.
   */
  function stripProtocol(url) {
    if (typeof url !== "string") return "";
    // NOTE: do not end the regex literal with /, — V8's parser can
    // confuse a trailing // with a line comment and break the
    // surrounding function. Use a non-greedy match-then-strip via
    // indexOf instead.
    const protoEnd = url.indexOf("://");
    if (protoEnd === -1) return url;
    return url.substring(protoEnd + 3);
  }

  /**
   * Render the Forwarded Address cell. For live LISTEN rows, show a
   * clickable link. For stopped/ghost rows, show plain text (no link).
   * The displayed text is "localhost:2345" (no protocol prefix) to
   * match VS Code's own Ports panel and avoid visual clutter. The
   * full URL with protocol is still passed via data-url so clicks
   * work.
   */
  function renderAddressCell(p) {
    const url = p.address || "";
    if (!url) {
      return '<td class="address">-</td>';
    }
    // What the user sees in the cell: protocol stripped, e.g.
    // "localhost:2345" instead of "http://localhost:2345".
    const displayUrl = stripProtocol(url);
    // Live rows get a clickable link + 3 inline action icons. The icons
    // are hidden by default and shown on hover/active state (matching
    // VS Code's Ports panel behavior).
    if (p.state === "LISTEN" && !p._ghost) {
      return (
        '<td class="address">' +
        '<a class="address-link" data-action="open-address" data-url="' + escapeAttr(url) + '" data-port="' + p.port + '" title="' + escapeAttr(url) + '">' + escapeAttr(displayUrl) + '</a>' +
        '<span class="address-actions">' +
        '<button class="address-icon" data-action="copy-address" data-url="' + escapeAttr(url) + '" data-port="' + p.port + '" title="Copy address">⧉</button>' +
        '<button class="address-icon" data-action="open-address" data-url="' + escapeAttr(url) + '" data-port="' + p.port + '" title="Open in browser">↗</button>' +
        '<button class="address-icon" data-action="preview-address" data-url="' + escapeAttr(url) + '" data-port="' + p.port + '" title="Open preview in editor">◫</button>' +
        '</span>' +
        '</td>'
      );
    }
    return '<td class="address"><span class="address-plain" title="' + escapeAttr(url) + '">' + escapeAttr(displayUrl) + '</span></td>';
  }

  function renderActionButtons(p, isConfirming, isPresetStopped, presetInfo) {
    if (isConfirming) {
      return (
        '<span class="confirm-group">' +
        '<button class="btn btn-sm btn-danger" data-action="confirm-kill" data-port="' + p.port + '" data-pid="' + (p.pid || "") + '">Confirm</button>' +
        '<button class="btn btn-sm btn-outline" data-action="cancel-kill">Cancel</button>' +
        "</span>"
      );
    }
    // Preset-owned, currently stopped: show Resume + a way to clear the row
    if (isPresetStopped && presetInfo) {
      const label = presetInfo.label;
      return (
        '<span class="action-group">' +
        '<button class="resume-btn" data-action="resume" data-port="' + p.port + '" data-label="' + escapeAttr(label) + '" title="Restart the preset on this port">RESUME</button>' +
        '<button class="forget-btn" data-action="forget-preset" data-port="' + p.port + '" data-label="' + escapeAttr(label) + '" title="Remove this stopped preset from the list">×</button>' +
        "</span>"
      );
    }
    // Non-preset stopped: show Resume (opens apps.json for setup) + ×
    if (p._stopped) {
      const procName = p.process || "";
      return (
        '<span class="action-group">' +
        '<button class="resume-btn" data-action="resume-stopped" data-port="' + p.port + '" data-process="' + escapeAttr(procName) + '" title="Set up a preset in apps.json to resume this process">RESUME</button>' +
        '<button class="forget-btn" data-action="forget-stopped" data-port="' + p.port + '" title="Remove this stopped process from the list">×</button>' +
        "</span>"
      );
    }
    return (
      '<span class="action-group">' +
      '<button class="stop-btn" data-action="stop" data-port="' + p.port + '" data-pid="' + (p.pid || "") + '" data-process="' + escapeAttr(p.process || "") + '" title="Graceful stop (SIGTERM)">STOP</button>' +
      '<button class="kill-btn" data-action="kill" data-port="' + p.port + '" data-process="' + escapeAttr(p.process || "") + '" title="Force kill (SIGKILL)">KILL</button>' +
      "</span>"
    );
  }

  function startStop(port, pid, processName) {
    console.debug("[port-manager] startStop:", { port, pid, processName });
    showToast("Stopping :" + port + " (pid=" + (pid || "auto") + ")…", "info");
    stoppingPorts.add(port);
    render();
    vscode.postMessage({ command: "stop", port, pid: pid || null, process: processName || null });
  }

  function startResume(port, label) {
    console.debug("[port-manager] startResume:", { port, label });
    stoppingPorts.delete(port);
    // Don't clear presetOverrides here — the backend's presetStarted
    // message will clear it (keyed by label, so port-bump is handled).
    vscode.postMessage({ command: "startPreset", port, label });
  }

  function forgetPreset(port, label) {
    console.debug("[port-manager] forgetPreset:", { port, label });
    stoppedPorts.delete(port);
    if (label) presetOverrides.delete(label);
    // Send the dedicated forgetPreset command — stopPreset would fail
    // because the preset is already STOPPED.
    vscode.postMessage({ command: "forgetPreset", port, label });
  }

  function forgetStopped(port) {
    console.debug("[port-manager] forgetStopped:", { port });
    stoppedPorts.delete(port);
    vscode.postMessage({ command: "forgetStopped", port });
  }

  function startResumeStopped(port, processName) {
    console.debug("[port-manager] startResumeStopped:", { port, processName });
    vscode.postMessage({ command: "resumeStopped", port, process: processName });
  }

  function updateBulkKillButton() {
    const activeSelected = [...selected].filter((p) =>
      ports.find((pp) => pp.port === p && pp.state === "LISTEN")
    );
    const btn = elements.bulkKillBtn();
    btn.style.display = activeSelected.length > 0 ? "inline-block" : "none";
    btn.textContent = "Kill Selected (" + activeSelected.length + ")";
  }

  function updateSortIndicators() {
    document.querySelectorAll("th[data-sort]").forEach((th) => {
      const col = th.dataset.sort;
      th.classList.toggle("sorted", col === currentSort.col);

      if (col === currentSort.col) {
        th.textContent =
          th.textContent.replace(/ [▲▼]$/, "") +
          (currentSort.dir === "asc" ? " ▲" : " ▼");
      } else {
        th.textContent = th.textContent.replace(/ [▲▼]$/, "");
      }
    });
  }

  // Event handlers
  elements.search().addEventListener("input", (e) => {
    filter = e.target.value;
    render();
  });

  function refresh() {
    stoppingPorts.clear();
    // Don't clear stoppedPorts / presetOverrides — ghost rows depend on them
    vscode.postMessage({ command: "refresh" });
  }

  /**
   * Open apps.json in the VS Code editor. The backend creates the file
   * with an empty array if it doesn't exist yet, then opens it
   * beside the webview. The backend also reloads presets so the
   * panel reflects any external edits.
   */
  function openAppsJson() {
    console.debug("[port-manager] openAppsJson");
    showToast("Opening apps.json…", "info");
    vscode.postMessage({ command: "openAppsJson" });
  }

  function sortBy(col) {
    console.debug("[port-manager] sortBy:", col, "prev=", currentSort);
    if (currentSort.col === col) {
      currentSort.dir = currentSort.dir === "asc" ? "desc" : "asc";
    } else {
      currentSort = { col, dir: "asc" };
    }
    render();
  }

  function togglePort(port) {
    if (selected.has(port)) {
      selected.delete(port);
    } else {
      selected.add(port);
    }
    render();
  }

  function toggleAll(checked) {
    if (checked) {
      ports.forEach((p) => selected.add(p.port));
    } else {
      selected.clear();
    }
    render();
  }

  function startKill(port, processName) {
    confirmingKill = port;
    confirmingKillProcess = processName || null;
    render();
  }

  function cancelKill() {
    confirmingKill = null;
    render();
  }

  function confirmKill(port, pid) {
    vscode.postMessage({
      command: "kill",
      port,
      pid: pid || null,
      process: confirmingKillProcess || null,
    });
    confirmingKillProcess = null;
  }

  function bulkKill() {
    const targets = [...selected].filter((p) =>
      ports.find((pp) => pp.port === p && pp.state === "LISTEN")
    );
    if (targets.length === 0) return;

    vscode.postMessage({ command: "bulkKill", ports: targets });
    selected.clear();
  }

  function toggleScan() {
    const panel = elements.scanPanel();
    panel.style.display = panel.style.display === "none" ? "flex" : "none";
  }

  function scanRange() {
    const from = parseInt(elements.scanFrom().value) || 3000;
    const to = parseInt(elements.scanTo().value) || 9999;
    vscode.postMessage({ command: "scan", from, to });
  }

  function showToast(msg, type) {
    const container = elements.toastContainer();
    const el = document.createElement("div");
    el.className = "toast toast-" + type;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  // Initial load
  vscode.postMessage({ command: "refresh" });

  // Periodic auto-refresh: pick up external port changes (e.g. another
  // process binds to a port that was previously owned by a stopped
  // preset). Without this, ghost rows can stay visible forever after
  // a new process takes over the port.
  //
  // Lightweight: 10s interval (was 3s) and pauses when the webview
  // is hidden (e.g. user switched tabs) — saves ~7 subprocess
  // spawns/min when the panel isn't visible.
  let refreshTimer = null;
  function startAutoRefresh() {
    if (refreshTimer !== null) return;
    refreshTimer = setInterval(() => {
      if (document.hidden) return;
      vscode.postMessage({ command: "refresh" });
    }, 10000);
  }
  function stopAutoRefresh() {
    if (refreshTimer !== null) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }
  startAutoRefresh();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopAutoRefresh();
    else {
      // Force a refresh right after becoming visible, then resume the timer
      vscode.postMessage({ command: "refresh" });
      startAutoRefresh();
    }
  });
`;
};
