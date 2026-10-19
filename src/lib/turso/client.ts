/**
 * @file client.ts
 * @description Cloudflare Workers D1Database compatible client for Turso / libSQL over HTTP (Hrana v2).
 */

import {
  D1Database,
  D1PreparedStatement,
  D1Result,
  D1ExecResult,
  D1DatabaseSession
} from '@cloudflare/workers-types';
import { Env } from '../../types';
import {
  HranaRequest,
  HranaStepResult,
  HranaExecuteResult,
  HranaPipelineResponse,
  toHranaValue,
  fromHranaValue
} from './protocol';
import { normalizeTursoUrl } from './config';
import { splitSqlStatements } from './sql';

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
  private selectCache = new Map<string, { result: HranaExecuteResult; expiresAt: number }>();
  private readonly maxSelectCacheEntries = 300;

  constructor(
    public readonly url: string,
    public readonly authToken: string
  ) {
    this.endpoint = `${normalizeTursoUrl(url)}/v2/pipeline`;
  }

  private isReadOnlyQuery(sql: string): boolean {
    const trimmed = sql.trim().toUpperCase();
    return trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA');
  }

  /**
   * Clears in-memory SELECT cache when mutating queries execute.
   */
  clearSelectCache(): void {
    this.selectCache.clear();
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
   * Caches read-only SELECT queries in-memory for 30 seconds to protect against subrequest exhaustion.
   *
   * @param sql - SQL query text.
   * @param params - Query parameters.
   * @returns HranaExecuteResult object.
   */
  async executeStatement(sql: string, params: any[]): Promise<HranaExecuteResult> {
    const isReadOnly = this.isReadOnlyQuery(sql);
    const cacheKey = isReadOnly ? `${sql}::${JSON.stringify(params)}` : '';

    if (isReadOnly) {
      const cached = this.selectCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.result;
      }
    } else {
      this.clearSelectCache();
    }

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

    const result = first.response?.result ?? {
      cols: [],
      rows: [],
      affected_row_count: 0,
      last_insert_rowid: null
    };

    if (isReadOnly) {
      if (this.selectCache.size >= this.maxSelectCacheEntries) {
        const oldestKey = this.selectCache.keys().next().value;
        if (oldestKey !== undefined) this.selectCache.delete(oldestKey);
      }
      this.selectCache.set(cacheKey, { result, expiresAt: Date.now() + 30_000 });
    }

    return result;
  }

  /**
   * Executes multiple prepared statements atomically inside a transaction.
   * Automatically clears SELECT cache as mutations may occur in the batch.
   *
   * @param statements - Array of prepared statements to batch.
   * @returns Array of D1Result objects.
   */
  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.clearSelectCache();
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
    this.clearSelectCache();
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
