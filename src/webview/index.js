/**
 * Port Manager - Webview HTML Generator
 */

const getStyles = require("./styles");
const getScript = require("./script");

/**
 * Generate the complete webview HTML content
 * @returns {string} HTML content
 */
function getWebviewContent() {
  return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${getStyles()}</style>
</head>
<body>
  ${getToolbar()}
  ${getScanPanel()}
  <div class="stats" id="stats"></div>
  ${getTable()}
  <div class="empty" id="empty" style="display:none">No matching ports found</div>
  <div id="toastContainer"></div>
  <script>${getScript()}</script>
</body>
</html>`;
}

function getToolbar() {
  return /*html*/ `
<div class="toolbar">
  <input type="text" id="search" placeholder="Search by port or process name...">
  <button class="btn" onclick="refresh()">Refresh</button>
  <button class="btn btn-outline" onclick="toggleScan()">Range Scan</button>
  <button class="btn btn-outline" onclick="openAppsJson()" title="Open apps.json in the editor to add, edit, or remove preset definitions">Edit Config</button>
  <button class="btn btn-danger" id="bulkKillBtn" style="display:none" onclick="bulkKill()">Kill Selected</button>
  <span class="build-tag" id="buildTag" title="Webview build identifier — confirms the latest code is loaded">v1.0.3</span>
</div>`;
}

function getScanPanel() {
  return /*html*/ `
<div class="scan-panel" id="scanPanel" style="display:none">
  <label>Range:</label>
  <input type="number" id="scanFrom" value="3000">
  <span style="opacity:0.4">–</span>
  <input type="number" id="scanTo" value="9999">
  <button class="btn btn-sm" onclick="scanRange()">Run</button>
</div>`;
}

function getTable() {
  return /*html*/ `
<table>
  <thead>
    <tr>
      <th style="width:36px">
        <input type="checkbox" id="selectAll" onchange="toggleAll(this.checked)">
      </th>
      <th data-sort="port" onclick="sortBy('port')" class="sorted">Port ▲</th>
      <th data-sort="address" onclick="sortBy('address')">Forwarded Address</th>
      <th data-sort="state" onclick="sortBy('state')">State</th>
      <th data-sort="process" onclick="sortBy('process')">Process</th>
      <th style="width:200px">Note</th>
      <th data-sort="pid" onclick="sortBy('pid')">PID</th>
      <th data-sort="ram" onclick="sortBy('ram')">RAM</th>
      <th data-sort="vram" onclick="sortBy('vram')">VRAM</th>
      <th style="text-align:right">Action</th>
    </tr>
  </thead>
  <tbody id="tbody"></tbody>
</table>`;
}

module.exports = { getWebviewContent };
