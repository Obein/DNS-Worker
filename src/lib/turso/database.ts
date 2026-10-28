/**
 * @file database.ts
 * @description Cloudflare Workers D1Database compatible client for Turso / libSQL over HTTP (Hrana v2).
 */

import {
  D1Database,
  D1PreparedStatement,
  D1Result,
  D1ExecResult,
  D1DatabaseSession
} from '@cloudflare/workers-types';
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
import { TursoD1PreparedStatement } from './statement';

/**
 * Turso Database implementation adhering to Cloudflare Workers D1Database interface.
 */
export class TursoD1Database implements D1Database {
  public readonly url: string;
  public readonly authToken: string;
  public readonly endpoint: string;
  private selectCache = new Map<string, { result: HranaExecuteResult; expiresAt: number }>();
  private readonly maxSelectCacheEntries = 300;

  constructor(url: string, authToken: string) {
    this.url = url;
    this.authToken = authToken;
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
   * @param timeoutMs - Optional execution timeout in milliseconds (default 20,000ms).
   * @returns Array of step results.
   */
  async executePipeline(requests: HranaRequest[], timeoutMs = 20000): Promise<HranaStepResult[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort(new Error(`[Turso D1] Pipeline request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ requests }),
        signal: controller.signal
      });

      if (!res.ok) {
        const errorBody = await res.text().catch(() => '');
        throw new Error(`[Turso D1] HTTP ${res.status} ${res.statusText}: ${errorBody}`);
      }

      const json = (await res.json()) as HranaPipelineResponse;
      return json.results || [];
    } finally {
      clearTimeout(timeoutId);
    }
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
