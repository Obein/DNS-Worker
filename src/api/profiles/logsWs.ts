/**
 * @file logsWs.ts
 * @description WebSocket endpoint for real-time DNS log streaming and bidirectional gap sync.
 * Handles client subscriptions, low-overhead server-side change probing, and push notifications.
 */

import { Env, Profile, User, ExecutionContext, ResolutionLog } from '../../types';

export type LogWsClientMessage =
  | {
      type: 'SUBSCRIBE';
      sinceTimestamp: number;
      lastId?: number;
    }
  | {
      type: 'CHECK_NEW';
      sinceTimestamp?: number;
      lastId?: number;
    }
  | {
      type: 'SYNC_GAP';
      since: number;
      until: number;
      limit?: number;
    }
  | {
      type: 'PING';
    };

export type LogWsServerMessage =
  | {
      type: 'NEW_LOGS';
      logs: ResolutionLog[];
      latestTimestamp: number;
      latestId: number;
    }
  | {
      type: 'SYNC_DATA';
      logs: ResolutionLog[];
      hasMore: boolean;
    }
  | {
      type: 'PONG';
    }
  | {
      type: 'ERROR';
      message: string;
    };

/**
 * Handles incoming WebSocket upgrade requests for /api/profiles/:id/logs/ws.
 *
 * @param request - HTTP Upgrade Request
 * @param env - Worker environment bindings
 * @param user - Authenticated user
 * @param profile - Target Profile entity
 * @param ctx - Execution context
 * @returns Response with 101 Switching Protocols or error status
 */
export async function handleProfileLogsWs(
  request: Request,
  env: Env,
  user: User | null,
  profile: Profile,
  ctx: ExecutionContext
): Promise<Response> {
  const upgradeHeader = request.headers.get('Upgrade');
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
    return new Response('Expected Upgrade: websocket', { status: 426 });
  }

  // Ensure WebSocketPair is supported in runtime
  const globalObj = globalThis as unknown as {
    WebSocketPair?: new () => { 0: WebSocket; 1: WebSocket };
  };

  if (typeof globalObj.WebSocketPair === 'undefined') {
    return new Response('WebSocket is not supported on this runtime environment', { status: 501 });
  }

  const pair = new globalObj.WebSocketPair();
  const [clientWs, serverWs] = Object.values(pair);

  // Accept server-side WebSocket
  (serverWs as unknown as { accept: () => void }).accept();

  const profileId = profile.id;
  let isClosed = false;
  let lastTimestamp = 0;
  let lastId = 0;
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let isChecking = false;

  // Keep Cloudflare Workers isolate alive for the entire lifespan of this WebSocket
  let socketCloseResolver: (() => void) | null = null;
  const socketLifetimePromise = new Promise<void>((resolve) => {
    socketCloseResolver = resolve;
  });

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(socketLifetimePromise);
  }

  /**
   * Probes for new logs since (lastTimestamp, lastId).
   * Runs a lightweight LIMIT 1 index probe first before running the full query.
   */
  const checkForNewLogs = async (): Promise<void> => {
    if (isClosed || isChecking || lastTimestamp <= 0) return;
    isChecking = true;

    try {
      // Step 1: Low-overhead index probe
      const probe = await env.DB.prepare(`
        SELECT id, timestamp 
        FROM logs 
        WHERE profile_id = ? AND (timestamp > ? OR (timestamp = ? AND id > ?))
        ORDER BY timestamp DESC, id DESC 
        LIMIT 1;
      `)
        .bind(profileId, lastTimestamp, lastTimestamp, lastId)
        .first<{ id: number; timestamp: number }>();

      if (!probe) {
        // No newer logs found, skip detailed extraction
        return;
      }

      // Step 2: Since new logs are confirmed, fetch details with access point name
      const { results } = await env.DB.prepare(`
        SELECT l.id, l.timestamp, l.client_ip, l.domain, l.action, l.record_type, 
               l.latency, l.answer, l.geo_country, l.reason, l.access_point_id, 
               l.dest_country_code, l.dest_country, l.dest_isp, l.encrypt_version, 
               l.kem_key_id, l.encrypted_payload, k.kem_ct, ap.name as access_point_name 
        FROM logs l 
        LEFT JOIN access_points ap ON l.access_point_id = ap.id 
        LEFT JOIN kem_keys k ON l.kem_key_id = k.id
        WHERE l.profile_id = ? AND (l.timestamp > ? OR (l.timestamp = ? AND l.id > ?))
        ORDER BY l.timestamp DESC, l.id DESC 
        LIMIT 50;
      `)
        .bind(profileId, lastTimestamp, lastTimestamp, lastId)
        .all<ResolutionLog>();

      if (results && results.length > 0) {
        const newest = results[0];
        lastTimestamp = newest.timestamp;
        lastId = Number(newest.id);

        if (!isClosed) {
          const payload: LogWsServerMessage = {
            type: 'NEW_LOGS',
            logs: results,
            latestTimestamp: lastTimestamp,
            latestId: lastId,
          };
          serverWs.send(JSON.stringify(payload));
        }
      }
    } catch (err: unknown) {
      console.error('[Logs WS] Error probing new logs:', err);
    } finally {
      isChecking = false;
    }
  };

  // Start periodic 2-second background check
  pollInterval = setInterval(() => {
    void checkForNewLogs();
  }, 2000);

  // Listen to client messages
  serverWs.addEventListener('message', async (event: MessageEvent) => {
    try {
      const dataStr = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
      const msg = JSON.parse(dataStr) as LogWsClientMessage;

      switch (msg.type) {
        case 'SUBSCRIBE': {
          lastTimestamp = msg.sinceTimestamp;
          lastId = msg.lastId || 0;
          await checkForNewLogs();
          break;
        }
        case 'CHECK_NEW': {
          if (msg.sinceTimestamp !== undefined) lastTimestamp = msg.sinceTimestamp;
          if (msg.lastId !== undefined) lastId = msg.lastId;
          await checkForNewLogs();
          break;
        }
        case 'SYNC_GAP': {
          const limit = Math.min(msg.limit || 100, 100);
          const { results } = await env.DB.prepare(`
            SELECT l.id, l.timestamp, l.client_ip, l.domain, l.action, l.record_type, 
                   l.latency, l.answer, l.geo_country, l.reason, l.access_point_id, 
                   l.dest_country_code, l.dest_country, l.dest_isp, l.encrypt_version, 
                   l.kem_key_id, l.encrypted_payload, k.kem_ct, ap.name as access_point_name 
            FROM logs l 
            LEFT JOIN access_points ap ON l.access_point_id = ap.id 
            LEFT JOIN kem_keys k ON l.kem_key_id = k.id
            WHERE l.profile_id = ? AND l.timestamp >= ? AND l.timestamp <= ?
            ORDER BY l.timestamp DESC, l.id DESC 
            LIMIT ?;
          `)
            .bind(profileId, msg.since, msg.until, limit)
            .all<ResolutionLog>();

          if (!isClosed) {
            const payload: LogWsServerMessage = {
              type: 'SYNC_DATA',
              logs: results || [],
              hasMore: (results?.length || 0) >= limit,
            };
            serverWs.send(JSON.stringify(payload));
          }
          break;
        }
        case 'PING': {
          if (!isClosed) {
            const payload: LogWsServerMessage = { type: 'PONG' };
            serverWs.send(JSON.stringify(payload));
            void checkForNewLogs();
          }
          break;
        }
        default:
          break;
      }
    } catch (err: unknown) {
      console.error('[Logs WS] Message processing error:', err);
    }
  });

  const cleanup = (): void => {
    if (isClosed) return;
    isClosed = true;
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    try {
      serverWs.close();
    } catch {
      // Ignore if socket already closed
    }
    if (socketCloseResolver) {
      socketCloseResolver();
      socketCloseResolver = null;
    }
  };

  serverWs.addEventListener('close', cleanup);
  serverWs.addEventListener('error', cleanup);

  return new Response(null, {
    status: 101,
    webSocket: clientWs,
  });
}
