/**
 * @file statement.ts
 * @description Cloudflare Workers D1PreparedStatement implementation for Turso / libSQL over Hrana v2.
 */

import {
  D1PreparedStatement,
  D1Result
} from '@cloudflare/workers-types';
import type { TursoD1Database } from './database';
import { fromHranaValue } from './protocol';

/**
 * PreparedStatement implementation for Turso Hrana v2 pipeline.
 */
export class TursoD1PreparedStatement implements D1PreparedStatement {
  public readonly db: TursoD1Database;
  public readonly sql: string;
  private params: any[] = [];

  constructor(db: TursoD1Database, sql: string) {
    this.db = db;
    this.sql = sql;
  }

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
