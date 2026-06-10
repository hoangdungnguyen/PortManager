/**
 * Port Manager - Webview Styles
 */

module.exports = function getStyles() {
  return /*css*/ `
  :root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --border: var(--vscode-panel-border, #333);
    --accent: #00E676;
    --danger: #FF5252;
    --hover: var(--vscode-list-hoverBackground);
    --badge-listen-bg: #FF5252;
    --badge-listen-fg: #fff;
    --badge-free-bg: #00E676;
    --badge-free-fg: #003311;
    --header-bg: var(--vscode-sideBarSectionHeader-background, #1e1e2e);
    --input-bg: var(--vscode-input-background);
    --input-fg: var(--vscode-input-foreground);
    --input-border: var(--vscode-input-border, #444);
    --btn-bg: var(--vscode-button-background);
    --btn-fg: var(--vscode-button-foreground);
    --btn-hover: var(--vscode-button-hoverBackground);
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: var(--bg);
    color: var(--fg);
    font-family: var(--vscode-font-family, system-ui);
    font-size: 13px;
    padding: 0;
  }

  /* Toolbar */
  .toolbar {
    display: flex;
    gap: 6px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    align-items: center;
    flex-wrap: wrap;
    position: sticky;
    top: 0;
    background: var(--bg);
    z-index: 10;
  }

  .toolbar input[type="text"] {
    flex: 1;
    min-width: 120px;
    padding: 5px 10px;
    border-radius: 4px;
    border: 1px solid var(--input-border);
    background: var(--input-bg);
    color: var(--input-fg);
    font-family: inherit;
    font-size: 12px;
    outline: none;
  }

  .toolbar input:focus { border-color: var(--accent); }

  /* Buttons */
  .btn {
    padding: 5px 12px;
    border-radius: 4px;
    border: none;
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    background: var(--btn-bg);
    color: var(--btn-fg);
    white-space: nowrap;
  }

  .btn:hover { background: var(--btn-hover); }
  .btn-danger { background: var(--danger); color: #fff; }
  .btn-danger:hover { opacity: 0.85; }

  .btn-outline {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--fg);
  }

  .btn-outline:hover { background: var(--hover); }
  .btn-sm { padding: 3px 8px; font-size: 11px; }

  /* Stats */
  .stats {
    display: flex;
    gap: 16px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
    opacity: 0.7;
  }

  .stats span { display: flex; align-items: center; gap: 4px; }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
  }

  /* Table */
  table { width: 100%; border-collapse: collapse; }

  th {
    text-align: left;
    padding: 7px 12px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    opacity: 0.5;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    user-select: none;
    position: sticky;
    top: 72px;
    background: var(--bg);
    z-index: 5;
  }

  th:hover { opacity: 0.8; }
  th.sorted { opacity: 1; color: var(--accent); }

  td {
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
  }

  tr:hover td { background: var(--hover); }
  tr.selected td { background: rgba(0, 230, 118, 0.08); }
  tr.stopping td { opacity: 0.5; }
  tr.stopped td { opacity: 0.4; font-style: italic; }

  /* Badges */
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
  }

  .badge-listen { background: var(--badge-listen-bg); color: var(--badge-listen-fg); }
  .badge-free { background: var(--badge-free-bg); color: var(--badge-free-fg); }

  /* Port display */
  .port-num {
    font-weight: 700;
    font-family: var(--vscode-editor-font-family, monospace);
  }

  .process-name { color: var(--accent); }

  /* Preset marker (small badge next to preset label) */
  .preset-tag {
    display: inline-block;
    padding: 1px 5px;
    margin-right: 4px;
    border-radius: 3px;
    background: rgba(33, 150, 243, 0.15);
    color: #2196F3;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    vertical-align: middle;
    font-family: var(--vscode-editor-font-family, monospace);
  }

  .preset-label {
    font-weight: 600;
  }

  .process-subtitle {
    font-size: 10px;
    opacity: 0.5;
    margin-top: 2px;
    color: var(--fg);
    font-family: var(--vscode-editor-font-family, monospace);
  }

  .pid {
    opacity: 0.5;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
  }

  .ram, .vram {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
    opacity: 0.8;
    white-space: nowrap;
  }

  /* Kill button */
  .kill-btn {
    padding: 2px 10px;
    border-radius: 4px;
    font-size: 11px;
    border: 1px solid var(--danger);
    background: transparent;
    color: var(--danger);
    cursor: pointer;
    font-family: inherit;
    transition: all 0.15s;
  }

  .kill-btn:hover { background: var(--danger); color: #fff; }

  /* Stop button (graceful, SIGTERM) */
  .stop-btn {
    padding: 2px 10px;
    border-radius: 4px;
    font-size: 11px;
    border: 1px solid var(--accent);
    background: transparent;
    color: var(--accent);
    cursor: pointer;
    font-family: inherit;
    transition: all 0.15s;
  }

  .stop-btn:hover { background: var(--accent); color: #003311; }

  /* Resume button (restart a stopped preset) */
  .resume-btn {
    padding: 2px 10px;
    border-radius: 4px;
    font-size: 11px;
    border: 1px solid #2196F3;
    background: transparent;
    color: #2196F3;
    cursor: pointer;
    font-family: inherit;
    transition: all 0.15s;
  }

  .resume-btn:hover { background: #2196F3; color: #fff; }

  /* Forget/clear button (remove stopped preset from list) */
  .forget-btn {
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 11px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--fg);
    opacity: 0.5;
    cursor: pointer;
    font-family: inherit;
    transition: all 0.15s;
  }

  .forget-btn:hover { opacity: 1; background: var(--hover); }

  /* Non-preset stopped row: no Resume button, just an em-dash placeholder */
  .no-resume-hint {
    display: inline-block;
    padding: 2px 10px;
    font-size: 11px;
    opacity: 0.4;
    color: var(--fg);
  }

  .action-group { display: inline-flex; gap: 4px; justify-content: flex-end; }

  .confirm-group { display: inline-flex; gap: 4px; }

  /* Stopped-state badge (preset that was stopped) */
  .badge-stopped { background: #555; color: #ccc; }

  /* Empty state */
  .empty { text-align: center; padding: 40px; opacity: 0.4; }

  /* Toast notifications */
  .toast {
    position: fixed;
    bottom: 16px;
    right: 16px;
    padding: 10px 18px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    z-index: 100;
    animation: slideUp 0.3s ease;
  }

  .toast-success { background: var(--accent); color: #003311; }
  .toast-error { background: var(--danger); color: #fff; }

  @keyframes slideUp {
    from { transform: translateY(20px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }

  /* Checkbox */
  input[type="checkbox"] { accent-color: var(--accent); }

  /* Scan panel */
  .scan-panel {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }

  .scan-panel input[type="number"] {
    width: 80px;
    padding: 4px 8px;
    border-radius: 4px;
    border: 1px solid var(--input-border);
    background: var(--input-bg);
    color: var(--input-fg);
    font-family: inherit;
    font-size: 12px;
  }

  .scan-panel label { font-size: 12px; opacity: 0.6; }

  /* Build tag (confirms webview code version is current) */
  .build-tag {
    margin-left: auto;
    font-size: 10px;
    opacity: 0.4;
    font-family: var(--vscode-editor-font-family, monospace);
    padding: 2px 6px;
    border-radius: 3px;
    border: 1px solid var(--border);
    user-select: text;
  }

  /* Forwarded Address cell */
  .address {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .address-link {
    color: var(--vscode-textLink-foreground, #3794ff);
    text-decoration: none;
    cursor: pointer;
    user-select: none;
  }

  .address-link:hover {
    color: var(--vscode-textLink-activeForeground, #3794ff);
    text-decoration: underline;
  }

  .address-actions {
    display: inline-flex;
    gap: 0;
    margin-left: 4px;
    opacity: 1;
  }

  .address-icon {
    background: transparent;
    border: none;
    color: var(--vscode-textLink-foreground, #3794ff);
    opacity: 0.7;
    font-size: 12px;
    line-height: 1;
    padding: 1px 3px;
    cursor: pointer;
    border-radius: 3px;
    font-family: var(--vscode-editor-font-family, monospace);
    min-width: 16px;
    text-align: center;
  }

  .address-icon:hover {
    background: var(--vscode-toolbar-hoverBackground, #5a5d5e50);
    opacity: 1;
  }

  .address-icon:active {
    background: var(--vscode-toolbar-activeBackground, #5a5d5e80);
  }

  .address-plain {
    color: var(--fg);
    opacity: 0.6;
  }

  /* Note column: user-authored annotations per port */
  .note-cell {
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .note-display {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    width: 100%;
  }
  .note-text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg);
    font-weight: 700;
    font-family: var(--vscode-editor-font-family, monospace);
  }
  .note-empty {
    flex: 1;
    color: var(--fg);
    opacity: 0.35;
    font-style: italic;
  }
  .note-edit-btn {
    visibility: hidden;
    background: transparent;
    border: none;
    color: var(--vscode-textLink-foreground, #3794ff);
    cursor: pointer;
    padding: 0 4px;
    font-size: 13px;
    line-height: 1;
  }
  .note-cell:hover .note-edit-btn,
  .note-empty:hover ~ .note-edit-btn {
    visibility: visible;
  }
  .note-edit-btn:hover {
    color: var(--vscode-textLink-activeForeground, #3794ff);
  }
  .note-edit {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    width: 100%;
  }
  .note-input {
    flex: 1;
    min-width: 0;
    background: var(--vscode-input-background, #3c3c3c);
    color: var(--vscode-input-foreground, #cccccc);
    border: 1px solid var(--vscode-input-border, #3c3c3c);
    border-radius: 2px;
    padding: 2px 6px;
    font-size: 12px;
    outline: none;
  }
  .note-input:focus {
    border-color: var(--vscode-focusBorder, #007fd4);
  }
  .note-save-btn,
  .note-cancel-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0 4px;
    font-size: 13px;
    line-height: 1;
  }
  .note-save-btn {
    color: var(--vscode-testing-iconPassed, #73c991);
  }
  .note-save-btn:hover {
    color: var(--vscode-testing-iconPassed, #73c991);
    opacity: 0.7;
  }
  .note-cancel-btn {
    color: var(--vscode-descriptionForeground, #999);
  }
  .note-cancel-btn:hover {
    color: var(--vscode-foreground, #fff);
  }

  /* Custom right-click context menu */
  .context-menu {
    position: fixed;
    z-index: 200;
    background: var(--vscode-menu-background, #252526);
    border: 1px solid var(--vscode-menu-border, #454545);
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    padding: 4px 0;
    min-width: 100px;
  }

  .context-menu-item {
    display: block;
    width: 100%;
    padding: 4px 12px;
    border: none;
    background: transparent;
    color: var(--fg);
    text-align: left;
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .context-menu-item:hover {
    background: var(--vscode-menu-selectionBackground, #094771);
    color: var(--vscode-menu-selectionForeground, #ffffff);
  }
`;
};
