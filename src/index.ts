import { Env, User, ExecutionContext } from './types';
import { ScheduledEvent } from '@cloudflare/workers-types';
import { readCsrfCookie, createCsrfCookie, generateId } from './lib/auth';
import { generateLinuxSetupScript } from './utils/linuxSetup';
import { ACCESS_KEY_REGEX } from './utils/validator';

// Middleware imports
import { applySecurityHeaders, getCurrentUser, validateCsrf } from './lib/middleware';

// Route handlers
import { handleAuthRequest } from './api/auth';
import { handleProfilesRequest } from './api/profiles';
import { handleAccountRequest } from './api/account';
import { handleSystemRequest } from './api/system';
import { handleDoHRequest } from './api/doh';
import { handleScheduled } from './cron';
import { handleMapDataRequest } from './api/mapData';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const nonceBytes = new Uint8Array(16);
    crypto.getRandomValues(nonceBytes);
    const nonce = Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('');

    let currentUser: User | null = null;

    const handleRequest = async (): Promise<Response> => {
      const url = new URL(request.url);

      // Map Data API Proxy
      if (url.pathname === '/world-110m.json') {
        return handleMapDataRequest(request, env, ctx);
      }

      // Auth API Routes (Unauthenticated)
      if (url.pathname.startsWith('/api/auth/')) {
        return handleAuthRequest(request, env);
      }

      // Business API Router
      if (url.pathname.startsWith('/api/')) {
        // Authenticate request
        currentUser = await getCurrentUser(request, env);

        const isPublicRoute = [
          '/api/auth/login', '/api/auth/signup', '/api/auth/prelogin', '/api/auth/check-username',
          '/api/clientinfo', '/api/regions'
        ].includes(url.pathname);
        const isMobileConfigRoute = url.pathname.endsWith('/mobileconfig');

        // Check authentication boundary
        if (!currentUser && !isPublicRoute && !isMobileConfigRoute) {
          return new Response("Unauthorized", { status: 401 });
        }

        // Validate CSRF for mutating requests
        if (currentUser && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && !isPublicRoute) {
          if (!validateCsrf(request)) {
            return new Response("CSRF validation failed", { status: 403 });
          }
        }

        // Route requests to handlers
        if (url.pathname === '/api/clientinfo' || url.pathname === '/api/regions' || url.pathname === '/api/substitute') {
          return handleSystemRequest(request, env);
        }
        if (url.pathname.startsWith('/api/profiles')) {
          return handleProfilesRequest(request, env, currentUser, ctx);
        }
        if (url.pathname.startsWith('/api/account') || url.pathname.startsWith('/api/admin')) {
          return handleAccountRequest(request, env, currentUser!, ctx);
        }
        return new Response("API Not Found", { status: 404 });
      }

      // Linux Setup Script Route
      if (url.pathname === '/setup.sh') {
        const key = url.searchParams.get('key');
        if (!key || !ACCESS_KEY_REGEX.test(key)) {
          return new Response('Missing or invalid key parameter', { status: 400 });
        }
        const script = generateLinuxSetupScript(url.origin, key);
        return new Response(script, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-cache'
          }
        });
      }

      // DNS-over-HTTPS (DoH) Route: /<6-12 digit profile key>
      const rawKey = url.pathname.slice(1); 
      const isKeyValid = ACCESS_KEY_REGEX.test(rawKey);
      const isDoHRequest = request.method === 'POST' || 
                           url.searchParams.has('dns') || 
                           request.headers.get('accept')?.includes('dns-message');
                            
      if (isKeyValid && isDoHRequest) {
        return handleDoHRequest(request, env, ctx, rawKey);
      }

      // Static Assets Hosting with Single Page App (SPA) fallback
      try {
        let response = await (env as any).ASSETS.fetch(request);
        if (response.status === 404) {
          response = await (env as any).ASSETS.fetch(new Request(url.origin + '/', request));
        }

        const contentType = response.headers.get('Content-Type') || '';
        if (contentType.includes('text/html')) {
          let configStr = "{}";
          try {
             const upstreams = env.PRESET_UPSTREAMS ? JSON.parse(env.PRESET_UPSTREAMS) : null;
             const filters = env.PRESET_EXTERNAL_FILTERS ? JSON.parse(env.PRESET_EXTERNAL_FILTERS) : null;
             configStr = JSON.stringify({ upstreams, filters });
          } catch (e) { }
          
          return new HTMLRewriter()
            .on('head', {
              element(element) {
                element.prepend(`<script nonce="${nonce}">window.OBEX_CONFIG = ${configStr};</script>`, { html: true });
              }
            })
            .transform(response);
        }

        return response;
      } catch (e) {
        return new Response("Asset Fetch Error", { status: 500 });
      }
    };

    let response = await handleRequest();
    
    // Ensure CSRF token is set in cookies if authenticated but cookie is missing from the request
    if (currentUser && !readCsrfCookie(request.headers.get("Cookie"))) {
      try {
        const csrfToken = generateId(32);
        response.headers.append("Set-Cookie", createCsrfCookie(csrfToken));
      } catch (e) {
        // If headers are immutable (e.g. from static asset fetch), clone the response and set the header
        const newHeaders = new Headers(response.headers);
        const csrfToken = generateId(32);
        newHeaders.append("Set-Cookie", createCsrfCookie(csrfToken));
        response = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders
        });
      }
    }

    return applySecurityHeaders(response, nonce);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    await handleScheduled(event, env, ctx);
  }
};
