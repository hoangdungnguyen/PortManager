/**
 * Tokenize a shell-style command string into [command, ...args],
 * respecting single and double quotes.
 * Pure function: no I/O, no process spawning.
 *
 * Examples:
 *   parseCommand('node server.js')
 *     -> ['node', 'server.js']
 *   parseCommand('unsloth studio --port ${port}')
 *     -> ['unsloth', 'studio', '--port', '${port}']
 *   parseCommand('echo "hello world"')
 *     -> ['echo', 'hello world']
 */
function parseCommand(input) {
  if (typeof input !== "string" || input.trim() === "") {
    return { ok: false, error: "Command must be a non-empty string" };
  }

  const tokens = [];
  let current = "";
  let quote = null; // current quote char, or null

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (quote) {
    return { ok: false, error: `Unclosed ${quote} in command` };
  }

  if (current.length > 0) tokens.push(current);

  if (tokens.length === 0) {
    return { ok: false, error: "No tokens parsed from command" };
  }

  return { ok: true, command: tokens[0], args: tokens.slice(1), tokens };
}

/**
 * Substitute ${port} (and any other ${var} placeholders) in a token list.
 * Unknown variables are left as-is so spawn errors are visible.
 *
 * @param {string[]} tokens
 * @param {Object} vars
 * @returns {string[]}
 */
function substituteVars(tokens, vars = {}) {
  return tokens.map((t) =>
    t.replace(/\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, name) =>
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : t
    )
  );
}

module.exports = { parseCommand, substituteVars };
