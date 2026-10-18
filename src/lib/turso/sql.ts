/**
 * @file sql.ts
 * @description SQL script splitting and parsing utilities.
 */

/**
 * Splits a SQL script containing multiple semicolon-delimited statements safely,
 * correctly ignoring semicolons inside strings and comments.
 *
 * @param sql - Raw SQL script.
 * @returns Array of individual SQL statement strings.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inString: false | "'" | '"' = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const nextChar = sql[i + 1];

    if (inLineComment) {
      if (char === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (char === '*' && nextChar === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      current += char;
      if (char === inString) {
        if (nextChar === inString) {
          // Escaped quote ('')
          current += nextChar;
          i++;
        } else {
          inString = false;
        }
      }
      continue;
    }

    if (char === '-' && nextChar === '-') {
      inLineComment = true;
      i++;
      continue;
    }
    if (char === '/' && nextChar === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (char === "'" || char === '"') {
      inString = char;
      current += char;
      continue;
    }

    if (char === ';') {
      const trimmed = current.trim();
      if (trimmed) {
        statements.push(trimmed);
      }
      current = '';
      continue;
    }

    current += char;
  }

  const trimmed = current.trim();
  if (trimmed) {
    statements.push(trimmed);
  }

  return statements;
}
