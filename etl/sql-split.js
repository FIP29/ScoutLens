// ---------------------------------------------------------------------
// Splits a .sql script into individual statements, honouring DELIMITER.
//
// `DELIMITER $$` is a *client* directive: the mysql CLI and MySQL Workbench
// understand it, but the server does not. The schema files use it so they
// remain runnable by hand in Workbench, which means anything that feeds
// them to the server programmatically has to do what the CLI does and
// interpret the directive itself.
//
// The scanner tracks quoting and comment state so a delimiter, a `--`, or
// a quote character inside a string literal is never mistaken for syntax.
// ---------------------------------------------------------------------

export function splitStatements(sql) {
  const statements = [];
  let delimiter = ';';
  let current = '';
  let i = 0;

  const atLineStart = () => current.trim() === '';

  while (i < sql.length) {
    const rest = sql.slice(i);

    // DELIMITER directive - only valid at the start of a statement.
    if (atLineStart()) {
      const directive = rest.match(/^[ \t]*DELIMITER[ \t]+(\S+)[ \t]*(\r?\n|$)/i);
      if (directive) {
        delimiter = directive[1];
        i += directive[0].length;
        current = '';
        continue;
      }
    }

    const ch = sql[i];

    // Line comments: -- to end of line, or # to end of line.
    if ((ch === '-' && sql[i + 1] === '-' && /[\s]/.test(sql[i + 2] ?? ' ')) || ch === '#') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end + 1;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // Block comment.
    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // Quoted literals and identifiers - copied verbatim, escapes respected.
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '\\' && ch !== '`') { j += 2; continue; }
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) { j += 2; continue; }  // '' escape
          break;
        }
        j++;
      }
      current += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }

    // Statement terminator.
    if (sql.startsWith(delimiter, i)) {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
      i += delimiter.length;
      continue;
    }

    current += ch;
    i++;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);

  // Drop fragments that are only comments or whitespace.
  return statements.filter((s) => {
    const stripped = s
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*(--[^\n]*|#[^\n]*)$/gm, '')
      .trim();
    return stripped.length > 0;
  });
}
