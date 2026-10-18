/**
 * @file protocol.ts
 * @description Hrana v2 protocol types and value serialization/deserialization.
 */

import { Buffer } from 'node:buffer';

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
