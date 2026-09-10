/**
 * @file sockets.ts
 * @description Universal socket connector supporting both Cloudflare Workers (cloudflare:sockets)
 * and Node.js (node:net) runtimes.
 */

import { Buffer } from 'node:buffer';

export interface UniversalSocket {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close(): Promise<void>;
}

export interface ConnectOptions {
  hostname: string;
  port: number;
  secureTransport?: 'off' | 'on' | 'starttls';
}

/**
 * Connects to a remote TCP or TLS server across Cloudflare Workers and Node.js environments.
 *
 * @param options - Target hostname, port, and optional secureTransport flag.
 * @returns An object containing readable and writable Web Streams and a close method.
 */
export async function connectUniversal(options: ConnectOptions): Promise<UniversalSocket> {
  // Check if running under Node.js runtime
  const isNode = typeof process !== 'undefined' && !!process.versions?.node;

  if (isNode) {
    if (options.secureTransport === 'on') {
      const tls = await import('node:tls');
      const net = await import('node:net');
      return new Promise<UniversalSocket>((resolve, reject) => {
        const client = tls.connect({
          host: options.hostname,
          port: options.port,
          servername: net.isIP(options.hostname) ? undefined : options.hostname
        }, () => {
          let isClosed = false;

          const readable = new ReadableStream<Uint8Array>({
            start(controller) {
              client.on('data', (chunk: Buffer | Uint8Array) => {
                controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
              });
              client.on('end', () => {
                try { controller.close(); } catch { /* ignore */ }
              });
              client.on('error', (err: Error) => {
                try { controller.error(err); } catch { /* ignore */ }
              });
            },
            cancel() {
              if (!isClosed) {
                isClosed = true;
                client.destroy();
              }
            }
          });

          const writable = new WritableStream<Uint8Array>({
            write(chunk) {
              return new Promise((res, rej) => {
                client.write(chunk, (err: Error | null | undefined) => (err ? rej(err) : res()));
              });
            },
            close() {
              return new Promise(res => {
                client.end(() => res());
              });
            },
            abort(err) {
              client.destroy(err as any);
            }
          });

          resolve({
            readable,
            writable,
            close: async () => {
              if (!isClosed) {
                isClosed = true;
                client.destroy();
              }
            }
          });
        });

        client.on('error', reject);
      });
    }

    const net = await import('node:net');
    return new Promise<UniversalSocket>((resolve, reject) => {
      const client = net.createConnection({ host: options.hostname, port: options.port }, () => {
        let isClosed = false;

        const readable = new ReadableStream<Uint8Array>({
          start(controller) {
            client.on('data', (chunk: Buffer | Uint8Array) => {
              controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
            });
            client.on('end', () => {
              try { controller.close(); } catch { /* ignore */ }
            });
            client.on('error', (err: Error) => {
              try { controller.error(err); } catch { /* ignore */ }
            });
          },
          cancel() {
            if (!isClosed) {
              isClosed = true;
              client.destroy();
            }
          }
        });

        const writable = new WritableStream<Uint8Array>({
          write(chunk) {
            return new Promise((res, rej) => {
              client.write(chunk, (err: Error | null | undefined) => (err ? rej(err) : res()));
            });
          },
          close() {
            return new Promise(res => {
              client.end(() => res());
            });
          },
          abort(err) {
            client.destroy(err as any);
          }
        });

        resolve({
          readable,
          writable,
          close: async () => {
            if (!isClosed) {
              isClosed = true;
              client.destroy();
            }
          }
        });
      });

      client.on('error', reject);
    });
  }

  // Cloudflare Workers runtime
  try {
    // @ts-ignore
    const cf = await import('cloudflare:sockets');
    return cf.connect(
      { hostname: options.hostname, port: options.port },
      { secureTransport: options.secureTransport || 'off', allowHalfOpen: false }
    );
  } catch (err) {
    throw new Error(`Socket connection failed in current environment: ${err}`);
  }
}
