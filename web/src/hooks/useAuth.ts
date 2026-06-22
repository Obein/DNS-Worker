import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { OverlayToaster } from "@blueprintjs/core";
import { getAccessToken, setAccessToken } from "../utils/token";
import { setSystemTimeZone, setSystemLocale } from "../utils/date";
import { refresh, getMe, logout, ApiError } from "../services";
import type { UserInfo } from "../services";

/**
 * Helper to clear the CSRF cookie and session storage flags.
 */
const clearCsrfToken = () => {
  document.cookie = "csrf_token=; Max-Age=0; path=/; Secure; SameSite=Lax";
  try {
    sessionStorage.removeItem("obex_session_active");
    sessionStorage.removeItem("obex_session_locked");
  } catch {}
};

/**
 * Custom hook managing authentication, current user details, and global unauthorized events.
 *
 * @param toasterRef - Ref to the Blueprint OverlayToaster to show authorization errors.
 */
export function useAuth(toasterRef: React.RefObject<OverlayToaster | null>) {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [currentUser, setCurrentUser] = useState<UserInfo | null>(null);
  const { t, i18n } = useTranslation();

  const checkAuth = async () => {
    try {
      // Check if we have a csrf_token cookie.
      const hasCsrfToken = document.cookie.includes("csrf_token=");
      if (!hasCsrfToken) {
        setIsLoggedIn(false);
        return;
      }

      // If we don't have an access token in memory, try to refresh first.
      if (!getAccessToken()) {
        try {
          const data = await refresh();
          setAccessToken(data.accessToken);
        } catch {
          clearCsrfToken();
          setIsLoggedIn(false);
          return;
        }
      }

      // Fetch user data (uses token automatically via fetch interceptor).
      try {
        const meData = await getMe();
        setCurrentUser(meData);

        if (meData.timezone) {
          setSystemTimeZone(meData.timezone);
        }
        if (meData.locale) {
          setSystemLocale(meData.locale);
          i18n.changeLanguage(meData.locale);
        }
        setIsLoggedIn(true);
      } catch (err: any) {
        if (err instanceof ApiError && err.status === 403 && err.bodyText === "session_paused") {
          setIsLoggedIn(true);
          window.dispatchEvent(new Event("session_paused"));
          return;
        }
        if (err instanceof ApiError && err.status === 401) {
          clearCsrfToken();
        }
        setIsLoggedIn(false);
      }
    } catch {
      setIsLoggedIn(false);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  // Listen for unauthorized events from the API client / interceptor
  useEffect(() => {
    const handleUnauthorized = (e: Event) => {
      clearCsrfToken();
      setIsLoggedIn(false);

      const customEvent = e as CustomEvent<{ reason?: string }>;
      const reason = customEvent.detail?.reason;

      if (reason === "missing") {
        return;
      }

      let message = t("auth.unauthorizedDefault");
      if (reason === "geolocation_mismatch" || reason === "geolocation_missing") {
        message = t("auth.unauthorizedGeo");
      } else if (reason === "expired") {
        message = t("auth.unauthorizedExpired");
      } else if (reason === "token_reuse") {
        message = t("auth.unauthorizedReuse");
      } else if (reason === "session_not_found") {
        message = t("auth.unauthorizedRevoked");
      }

      if (toasterRef.current) {
        toasterRef.current.show({
          message,
          intent: "danger",
          icon: "error",
          timeout: 5000,
        });
      }
    };

    window.addEventListener("auth_unauthorized", handleUnauthorized);
    return () => {
      window.removeEventListener("auth_unauthorized", handleUnauthorized);
    };
  }, [t, toasterRef]);

  const handleLogout = async () => {
    try {
      await logout();
    } catch (e) {
      console.error("Logout failed", e);
    } finally {
      if (typeof window !== "undefined" && "caches" in window) {
        try {
          await caches.delete("obex-dns-logs-v1");
        } catch {}
      }
      try {
        sessionStorage.removeItem("obex_session_active");
      } catch {}
      clearCsrfToken();
      setIsLoggedIn(false);
      window.location.reload();
    }
  };

  return {
    isLoggedIn,
    currentUser,
    checkAuth,
    handleLogout,
  };
}
