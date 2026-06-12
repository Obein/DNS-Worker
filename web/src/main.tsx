import { createRoot } from "react-dom/client";
import "./index.css";
import "./i18n/config";
import App from "./App.tsx";
import { OverlaysProvider, FocusStyleManager } from "@blueprintjs/core";
import { BrowserRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";

FocusStyleManager.onlyShowFocusOnTabs();

let cachedLat: string | null = null;
let cachedLon: string | null = null;

// Request browser geolocation once on app load
if (typeof window !== "undefined" && navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(
    (position) => {
      cachedLat = position.coords.latitude.toString();
      cachedLon = position.coords.longitude.toString();
    },
    (error) => {
      console.warn("Geolocation access denied or failed:", error);
    },
    { enableHighAccuracy: true, timeout: 5000 }
  );
}

// Global window.fetch interceptor to append client coordinates headers to API requests
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

  // Only intercept same-origin or relative /api/ requests
  if (url.startsWith("/api/") || url.includes(window.location.host + "/api/")) {
    if (cachedLat && cachedLon) {
      init = init || {};
      const headers = new Headers(init.headers);
      headers.set("X-Client-Latitude", cachedLat);
      headers.set("X-Client-Longitude", cachedLon);
      init.headers = headers;
    }
  }
  return originalFetch(input, init);
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

