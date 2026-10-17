/**
 * @file index.ts
 * @description Turso / libSQL D1Database adapter and migration runner.
 * Enables zero-dependency Hrana over HTTP (/v2/pipeline) connectivity for Cloudflare Workers
 * and Serverfull mode (Node.js/Bun/Docker).
 */

import { Buffer } from 'node:buffer';
import {
  D1Database,
  D1PreparedStatement,
  D1Result,
  D1ExecResult,
  D1DatabaseSession
} from '@cloudflare/workers-types';
import { Env } from '../../types';

export type HranaValue =
  | { type: 'null' }
  | { type: 'integer'; value: string }
  | { type: 'float'; value: number }
  | { type: 'text'; value: string }
  | { type: 'blob'; base64: string; value?: string };

export interface HranaStmt {
  sql: string;
  args?: HranaValue[];
}

export interface HranaRequest {
  type: 'execute' | 'close';
  stmt?: HranaStmt;
}

export interface HranaCol {
  name: string;
  decltype?: string;
}

export interface HranaExecuteResult {
  cols: HranaCol[];
  rows: HranaValue[][];
  affected_row_count: number;
  last_insert_rowid: string | null;
}

export interface HranaStepResult {
  type: 'ok' | 'error';
  response?: {
    type: 'execute' | 'close';
    result?: HranaExecuteResult;
  };
  error?: {
    message: string;
    code?: string;
  };
}

export interface HranaPipelineResponse {
  baton?: string | null;
  base_url?: string | null;
  results: HranaStepResult[];
}

/**
 * Converts a JavaScript value into an explicit Hrana protocol value object.
 *
 * @param val - The raw JavaScript value to serialize.
 * @returns Serialized HranaValue object.
 */
export function toHranaValue(val: unknown): HranaValue {
  if (val === null || val === undefined) {
    return { type: 'null' };
  }
  if (typeof val === 'boolean') {
    return { type: 'integer', value: val ? '1' : '0' };
  }
  if (typeof val === 'number') {
    if (Number.isInteger(val)) {
      return { type: 'integer', value: String(val) };
    }
    return { type: 'float', value: val };
  }
  if (typeof val === 'bigint') {
    return { type: 'integer', value: val.toString() };
  }
  if (typeof val === 'string') {
    return { type: 'text', value: val };
  }
  if (val instanceof ArrayBuffer) {
    const base64 = Buffer.from(val).toString('base64');
    return { type: 'blob', base64 };
  }
  if (ArrayBuffer.isView(val)) {
    const base64 = Buffer.from(val.buffer, val.byteOffset, val.byteLength).toString('base64');
    return { type: 'blob', base64 };
  }
  return { type: 'text', value: String(val) };
}

/**
 * Converts an incoming Hrana protocol value object back to a native JavaScript value.
 *
 * @param val - The Hrana value object received from Turso.
 * @returns Native JavaScript value (number, string, ArrayBuffer, null).
 */
export function fromHranaValue(val: HranaValue | any): any {
  if (!val || val.type === 'null') {
    return null;
  }
  if (val.type === 'integer') {
    const num = Number(val.value);
    return Number.isSafeInteger(num) ? num : BigInt(val.value);
  }
  if (val.type === 'float') {
    return Number(val.value);
  }
  if (val.type === 'text') {
    return val.value;
  }
  if (val.type === 'blob') {
    const b64 = val.base64 || val.value || '';
    const buf = Buffer.from(b64, 'base64');
    const ab = new ArrayBuffer(buf.length);
    new Uint8Array(ab).set(buf);
    return ab;
  }
  return val.value ?? val;
}

/**
 * Normalizes a Turso / libSQL connection URL to standard HTTPS endpoint.
 *
 * @param rawUrl - Input database URL (e.g., libsql://db-org.turso.io).
 * @returns Normalized HTTPS URL string.
 */
export function normalizeTursoUrl(rawUrl: string): string {
  let url = rawUrl.trim();
  if (url.startsWith('libsql://')) {
    url = 'https://' + url.slice('libsql://'.length);
  } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  return url.replace(/\/+$/, '');
}

/**
 * Safely masks a database URL for user-facing logs and diagnostics.
 *
 * @param rawUrl - Database URL to mask.
 * @returns Masked URL.
 */
export function maskDatabaseUrl(rawUrl: string): string {
  try {
    const normalized = normalizeTursoUrl(rawUrl);
    const u = new URL(normalized);
    return `${u.protocol}//${u.host}`;
  } catch {
    return rawUrl.slice(0, 16) + '...';
  }
}

/**
 * Supported database service engine types.
 */
export type DatabaseServiceType = 'D1' | 'Turso' | 'File';

/**
 * Checks whether Turso database is configured in the given environment.
 *
 * @param env - Application environment bindings or process.env.
 * @returns True if Turso database URL and auth token are present.
 */
export function isTursoConfigured(env?: Partial<Env> | NodeJS.ProcessEnv | null): boolean {
  if (!env) return false;
  const url = (env.TURSO_DATABASE_URL || (env as any).TURSO_URL)?.trim();
  const token = env.TURSO_AUTH_TOKEN?.trim();
  return Boolean(url && token);
}

/**
 * Resolves the active database service type ('D1' | 'Turso' | 'File') based on environment variables.
 * - Serverless mode (Cloudflare Workers) defaults to 'D1'.
 * - Serverfull mode (Node.js/Bun/Docker) defaults to 'File'.
 * - Explicit DATABASE_SERVICE ('D1', 'Turso', 'File', case-insensitive) takes highest precedence.
 * - If DATABASE_SERVICE is omitted but Turso credentials are fully configured, automatically resolves to 'Turso'.
 *
 * @param env - Application environment bindings or process.env.
 * @param isServerfull - True if running in Serverfull mode.
 * @returns Resolved DatabaseServiceType ('D1' | 'Turso' | 'File').
 */
export function getDatabaseService(
  env?: Partial<Env> | NodeJS.ProcessEnv | null,
  isServerfull = false
): DatabaseServiceType {
  const raw = (env?.DATABASE_SERVICE || (env as any)?.DB_SERVICE)?.trim().toLowerCase();
  if (raw === 'turso') return 'Turso';
  if (raw === 'd1') return 'D1';
  if (raw === 'file') return 'File';

  // If DATABASE_SERVICE is not explicitly set, but Turso credentials are fully provided, auto-enable Turso
  if (isTursoConfigured(env)) {
    return 'Turso';
  }

  // Standard platform defaults: D1 for Serverless, File for Serverfull
  return isServerfull ? 'File' : 'D1';
}

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

/**
 * PreparedStatement implementation for Turso Hrana v2 pipeline.
 */
export class TursoD1PreparedStatement implements D1PreparedStatement {
  private params: any[] = [];

  constructor(
    public readonly db: TursoD1Database,
    public readonly sql: string
  ) {}

  bind(...values: any[]): D1PreparedStatement {
    this.params = values.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v));
    return this as unknown as D1PreparedStatement;
  }

  getParams(): any[] {
    return this.params;
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    try {
      const res = await this.all<Record<string, any>>();
      if (!res.results || res.results.length === 0) {
        return null;
      }
      const row = res.results[0];
      if (colName) {
        return (row[colName] ?? null) as T;
      }
      return row as T;
    } catch (err: any) {
      console.warn(`[Turso D1] Query error in first(): ${err.message}\nSQL: ${this.sql}`);
      throw err;
    }
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    const start = Date.now();
    try {
      const result = await this.db.executeStatement(this.sql, this.params);
      const rows: T[] = result.rows.map((row) => {
        const obj: Record<string, any> = {};
        for (let i = 0; i < result.cols.length; i++) {
          obj[result.cols[i].name] = fromHranaValue(row[i]);
        }
        return obj as T;
      });

      return {
        results: rows,
        success: true,
        meta: {
          duration: Date.now() - start,
          size_after: 0,
          rows_read: rows.length,
          rows_written: result.affected_row_count || 0,
          last_row_id: result.last_insert_rowid ? Number(result.last_insert_rowid) : 0,
          changed_db: (result.affected_row_count || 0) > 0,
          changes: result.affected_row_count || 0
        }
      };
    } catch (err: any) {
      console.warn(`[Turso D1] Query error in all(): ${err.message}\nSQL: ${this.sql}`);
      throw err;
    }
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    const start = Date.now();
    try {
      const result = await this.db.executeStatement(this.sql, this.params);
      const changes = result.affected_row_count || 0;
      const lastRowId = result.last_insert_rowid ? Number(result.last_insert_rowid) : 0;
      return {
        results: [],
        success: true,
        meta: {
          duration: Date.now() - start,
          size_after: 0,
          rows_read: 0,
          rows_written: changes,
          last_row_id: lastRowId,
          changed_db: changes > 0,
          changes
        }
      };
    } catch (err: any) {
      console.warn(`[Turso D1] Query error in run(): ${err.message}\nSQL: ${this.sql}`);
      throw err;
    }
  }

  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<any> {
    try {
      const result = await this.db.executeStatement(this.sql, this.params);
      const rawRows = result.rows.map((row) => row.map(fromHranaValue));
      if (options?.columnNames && result.cols.length > 0) {
        return [result.cols.map((c) => c.name), ...rawRows];
      }
      return rawRows;
    } catch (err: any) {
      console.warn(`[Turso D1] Query error in raw(): ${err.message}\nSQL: ${this.sql}`);
      throw err;
    }
  }
}

/**
 * Turso Database implementation adhering to Cloudflare Workers D1Database interface.
 */
export class TursoD1Database implements D1Database {
  public readonly endpoint: string;

  constructor(
    public readonly url: string,
    public readonly authToken: string
  ) {
    this.endpoint = `${normalizeTursoUrl(url)}/v2/pipeline`;
  }

  prepare(query: string): D1PreparedStatement {
    return new TursoD1PreparedStatement(this, query) as unknown as D1PreparedStatement;
  }

  /**
   * Executes a pipeline request against Turso HTTP API.
   *
   * @param requests - Array of Hrana operations to evaluate.
   * @returns Array of step results.
   */
  async executePipeline(requests: HranaRequest[]): Promise<HranaStepResult[]> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ requests })
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(`[Turso D1] HTTP ${res.status} ${res.statusText}: ${errorBody}`);
    }

    const json = (await res.json()) as HranaPipelineResponse;
    return json.results || [];
  }

  /**
   * Executes a single parameterized statement and returns the raw execute result.
   *
   * @param sql - SQL query text.
   * @param params - Query parameters.
   * @returns HranaExecuteResult object.
   */
  async executeStatement(sql: string, params: any[]): Promise<HranaExecuteResult> {
    const hranaArgs = params.map(toHranaValue);
    const results = await this.executePipeline([
      {
        type: 'execute',
        stmt: {
          sql,
          args: hranaArgs
        }
      },
      { type: 'close' }
    ]);

    const first = results[0];
    if (!first) {
      throw new Error(`[Turso D1] Empty response from pipeline for SQL: ${sql}`);
    }
    if (first.type === 'error' || first.error) {
      const msg = first.error?.message || 'Unknown database error';
      throw new Error(`[Turso D1] Query error: ${msg}\nSQL: ${sql}`);
    }

    return (
      first.response?.result ?? {
        cols: [],
        rows: [],
        affected_row_count: 0,
        last_insert_rowid: null
      }
    );
  }

  /**
   * Executes multiple prepared statements atomically inside a transaction.
   *
   * @param statements - Array of prepared statements to batch.
   * @returns Array of D1Result objects.
   */
  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    if (statements.length === 0) return [];
    const start = Date.now();

    const requests: HranaRequest[] = [
      { type: 'execute', stmt: { sql: 'BEGIN IMMEDIATE' } }
    ];

    for (const s of statements) {
      const ts = s as unknown as TursoD1PreparedStatement;
      requests.push({
        type: 'execute',
        stmt: {
          sql: ts.sql,
          args: ts.getParams().map(toHranaValue)
        }
      });
    }

    requests.push(
      { type: 'execute', stmt: { sql: 'COMMIT' } },
      { type: 'close' }
    );

    const stepResults = await this.executePipeline(requests);

    // Check if any step failed
    for (let i = 0; i < stepResults.length; i++) {
      const step = stepResults[i];
      if (step.type === 'error' || step.error) {
        // Best-effort rollback
        try {
          await this.executePipeline([
            { type: 'execute', stmt: { sql: 'ROLLBACK' } },
            { type: 'close' }
          ]);
        } catch {
          // Ignore rollback failure
        }
        const sqlIndex = i - 1;
        const failedSql =
          sqlIndex >= 0 && sqlIndex < statements.length
            ? (statements[sqlIndex] as unknown as TursoD1PreparedStatement).sql
            : 'TRANSACTION';
        throw new Error(
          `[Turso D1] Batch statement ${i} failed: ${step.error?.message || 'Error'}\nSQL: ${failedSql}`
        );
      }
    }

    // Extract statement execution results (indices 1 to statements.length)
    const results: D1Result<T>[] = [];
    for (let i = 0; i < statements.length; i++) {
      const step = stepResults[i + 1];
      const execResult = step.response?.result ?? {
        cols: [],
        rows: [],
        affected_row_count: 0,
        last_insert_rowid: null
      };

      const rows: T[] = execResult.rows.map((row) => {
        const obj: Record<string, any> = {};
        for (let c = 0; c < execResult.cols.length; c++) {
          obj[execResult.cols[c].name] = fromHranaValue(row[c]);
        }
        return obj as T;
      });

      results.push({
        results: rows,
        success: true,
        meta: {
          duration: Date.now() - start,
          size_after: 0,
          rows_read: rows.length,
          rows_written: execResult.affected_row_count || 0,
          last_row_id: execResult.last_insert_rowid ? Number(execResult.last_insert_rowid) : 0,
          changed_db: (execResult.affected_row_count || 0) > 0,
          changes: execResult.affected_row_count || 0
        }
      });
    }

    return results;
  }

  /**
   * Executes raw multi-statement SQL strings.
   *
   * @param query - Raw SQL text (supports semicolon-delimited multiple statements).
   * @returns D1ExecResult object.
   */
  async exec(query: string): Promise<D1ExecResult> {
    const start = Date.now();
    const stmts = splitSqlStatements(query);
    if (stmts.length === 0) {
      return { count: 0, duration: 0 };
    }

    const requests: HranaRequest[] = stmts.map((s) => ({
      type: 'execute',
      stmt: { sql: s }
    }));
    requests.push({ type: 'close' });

    const stepResults = await this.executePipeline(requests);
    for (let i = 0; i < stmts.length; i++) {
      const step = stepResults[i];
      if (step.type === 'error' || step.error) {
        throw new Error(
          `[Turso D1] Exec error on statement ${i + 1}: ${step.error?.message || 'Error'}\nSQL: ${stmts[i]}`
        );
      }
    }

    return {
      count: stmts.length,
      duration: Date.now() - start
    };
  }

  async dump(): Promise<ArrayBuffer> {
    throw new Error('dump() is not supported in TursoD1Database');
  }

  withSession(_constraintOrBookmark?: string): D1DatabaseSession {
    const session = Object.assign(this, {
      getBookmark: () => null
    });
    return session as unknown as D1DatabaseSession;
  }
}

/**
 * Factory creating a new TursoD1Database instance.
 *
 * @param url - Turso database URL.
 * @param authToken - Turso authorization token.
 * @returns TursoD1Database instance.
 */
export function createTursoClient(url: string, authToken: string): TursoD1Database {
  return new TursoD1Database(url, authToken);
}

let cachedTursoClient: TursoD1Database | null = null;
let cachedTursoUrl: string | null = null;
let cachedTursoToken: string | null = null;

/**
 * Returns a cached isolate-level Turso database client matching current environment variables.
 *
 * @param env - Application environment.
 * @returns TursoD1Database client.
 */
export function getTursoDatabase(env: Env | Record<string, any>): TursoD1Database {
  const url = (env.TURSO_DATABASE_URL || env.TURSO_URL || '').trim();
  const token = (env.TURSO_AUTH_TOKEN || '').trim();

  if (!url || !token) {
    throw new Error('[Turso] Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN in environment.');
  }

  if (cachedTursoClient && cachedTursoUrl === url && cachedTursoToken === token) {
    return cachedTursoClient;
  }

  cachedTursoClient = createTursoClient(url, token);
  cachedTursoUrl = url;
  cachedTursoToken = token;
  return cachedTursoClient;
}
