/**
 * @file assets.ts
 * @description Static asset file serving and MIME mapping for Web Dashboard in Serverfull mode.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Env } from '../../types';
import { getPackageRoot } from '../config';

export const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm'
};

/**
 * Attaches the static asset file-serving handler to the worker Env if not already attached.
 *
 * @param env - The Cloudflare/Serverfull Env object.
 * @param staticDir - Optional path to the directory containing static frontend files.
 */
export function attachStaticAssetHandler(env: Env, staticDir?: string): void {
  if (env.ASSETS) return;

  const targetDir = staticDir || path.join(getPackageRoot(), 'static');

  env.ASSETS = {
    fetch: async (req: Request): Promise<Response> => {
      try {
        const url = new URL(req.url);
        let pathname = decodeURIComponent(url.pathname);
        if (pathname === '/' || pathname === '') {
          pathname = '/index.html';
        }

        const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
        const filePath = path.join(targetDir, safePath);

        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const ext = path.extname(filePath).toLowerCase();
          const contentType = MIME_TYPES[ext] || 'application/octet-stream';
          const fileContent = fs.readFileSync(filePath);

          return new Response(fileContent, {
            status: 200,
            headers: {
              'Content-Type': contentType,
              'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
              'Cross-Origin-Opener-Policy': 'same-origin',
              'Cross-Origin-Embedder-Policy': 'credentialless',
              'Cross-Origin-Resource-Policy': 'same-origin'
            }
          });
        }

        return new Response('Not Found', { status: 404 });
      } catch {
        return new Response('Asset Error', { status: 500 });
      }
    }
  };
}
