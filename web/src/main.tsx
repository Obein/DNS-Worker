import { createRoot } from "react-dom/client";
import "./index.css";
import "./i18n/config";
import App from "./App.tsx";
import { OverlaysProvider, FocusStyleManager } from "@blueprintjs/core";
import { BrowserRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { getAccessToken, setAccessToken } from "./utils/token";

FocusStyleManager.onlyShowFocusOnTabs();

let isRefreshing = false;
let lastRefreshReason = "unknown";
let refreshSubscribers: ((token: string) => void)[] = [];

function subscribeTokenRefresh(cb: (token: string) => void) {
  refreshSubscribers.push(cb);
}

function onRefreshed(token: string) {
  refreshSubscribers.forEach(cb => cb(token));
  refreshSubscribers = [];
}

// Global window.fetch interceptor to append CSRF headers to API requests
const originalFetch = window.fetch;
window.fetch = async function (input, init) {
  let url = "";
  if (typeof input === "string") {
    url = input;
  } else if (input instanceof URL) {
    url = input.href;
  } else if (input && typeof input === "object" && "url" in input) {
    url = (input as any).url;
  }

  const isApi = url.startsWith("/api/") || url.includes(window.location.host + "/api/");

  // Only intercept same-origin or relative /api/ requests
  if (isApi) {
    init = init || {};
    const headers = new Headers(init.headers);

    // CSRF double submit cookie header for mutations
    const method = init.method?.toUpperCase() || "GET";
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
      const csrfToken = match ? match[1] : null;
      if (csrfToken) {
        headers.set("X-CSRF-Token", csrfToken);
      }
    }

    // Access Token
    const token = getAccessToken();
    if (token && !url.includes("/api/auth/refresh")) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    init.headers = headers;
  }
  
  let response = await originalFetch(input, init);

  if (isApi && response.status === 401 && !url.includes("/api/auth/")) {
    if (!isRefreshing) {
      isRefreshing = true;
      originalFetch("/api/auth/refresh", { method: "POST" }).then(async (refreshRes) => {
        if (refreshRes.ok) {
          try {
            const data = await refreshRes.json();
            setAccessToken(data.accessToken);
            onRefreshed(data.accessToken);
          } catch {
            setAccessToken(null);
            lastRefreshReason = "invalid_payload";
            onRefreshed("");
          }
        } else {
          setAccessToken(null);
          let reason = "unknown";
          try {
            const text = await refreshRes.text();
            if (text === "Refresh token missing") {
              reason = "missing";
            } else {
              const data = JSON.parse(text);
              if (data && data.reason) reason = data.reason;
            }
          } catch {
            // Ignore JSON parsing/network errors
          }
          lastRefreshReason = reason;
          onRefreshed("");
        }
      }).catch(() => {
        setAccessToken(null);
        lastRefreshReason = "network_error";
        onRefreshed("");
      }).finally(() => {
        isRefreshing = false;
      });
    }

    const retryToken = await new Promise<string>((resolve) => {
      subscribeTokenRefresh(resolve);
    });

    if (retryToken) {
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${retryToken}`);
      response = await originalFetch(input, { ...init, headers });
    } else {
      // Refresh failed, dispatch a custom event to logout with details
      window.dispatchEvent(new CustomEvent('auth_unauthorized', { detail: { reason: lastRefreshReason } }));
    }
  }

  return response;
};

createRoot(document.getElementById("root")!).render(
  <OverlaysProvider>
    <HelmetProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </HelmetProvider>
  </OverlaysProvider>
);

