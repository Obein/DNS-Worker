import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useLocation } from "react-router-dom";
import type { OverlayToaster } from "@blueprintjs/core";
import { getAccessToken, setAccessToken } from "../utils/token";
import { setSystemTimeZone, setSystemLocale } from "../utils/date";
import {
  refresh,
  getProfiles,
  getMe,
  createProfile,
  deleteProfile,
  logout,
  ApiError
} from "../services";
import type { Profile, UserInfo } from "../services";

interface PrefilledRule {
  domain: string;
  type: "ALLOW" | "BLOCK" | "REDIRECT";
  recordType?: string;
}

/**
 * Helper to clear the CSRF cookie.
 */
const clearCsrfToken = () => {
  document.cookie = "csrf_token=; Max-Age=0; path=/; Secure; SameSite=Lax";
};

/**
 * Custom hook managing authentication, profiles list, selected profile,
 * dialog states, prefilled rules, and global unauthorized events.
 *
 * @param toasterRef - Ref to the Blueprint OverlayToaster to show authorization errors.
 */
export function useAuthAndProfiles(
  toasterRef: React.RefObject<OverlayToaster | null>
) {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentUser, setCurrentUser] = useState<UserInfo | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);

  // Profile creation states
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [createError, setCreateError] = useState("");

  // Quick Action / Prefilled Rule states
  const [prefilledRule, setPrefilledRule] = useState<PrefilledRule | null>(null);

  const navigate = useNavigate();
  const location = useLocation();
  const { t, i18n } = useTranslation();

  const checkAuthAndFetchData = async () => {
    try {
      // 1. Check if we have a csrf_token cookie.
      const hasCsrfToken = document.cookie.includes("csrf_token=");
      if (!hasCsrfToken) {
        setIsLoggedIn(false);
        return;
      }

      // 2. If we don't have an access token in memory, try to refresh first.
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

      // 3. Fetch data (uses token automatically via fetch interceptor).
      try {
        const [profilesData, meData] = await Promise.all([
          getProfiles(),
          getMe(),
        ]);
        setProfiles(profilesData);
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
    checkAuthAndFetchData();
  }, []);

  // Listen for unauthorized events from the API client / interceptor
  useEffect(() => {
    const handleUnauthorized = (e: Event) => {
      clearCsrfToken();
      setIsLoggedIn(false);
      setSelectedProfile(null);

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

  const handleCreateProfile = async () => {
    if (!newProfileName) return;
    try {
      await createProfile(newProfileName);
      setNewProfileName("");
      setShowCreateDialog(false);
      await checkAuthAndFetchData();
    } catch (err: any) {
      if (err instanceof ApiError) {
        setCreateError(err.bodyText);
      } else {
        setCreateError(t("common.errorNetwork"));
      }
    }
  };

  const handleDeleteProfile = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm(t("common.confirmDelete"))) return;
    try {
      await deleteProfile(id);
      await checkAuthAndFetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (e) {
      console.error("Logout failed", e);
    } finally {
      clearCsrfToken();
      setIsLoggedIn(false);
      setSelectedProfile(null);
      window.location.reload();
    }
  };

  const handleQuickAction = (
    domain: string,
    type: "ALLOW" | "BLOCK" | "REDIRECT",
    recordType?: string
  ) => {
    setPrefilledRule({ domain, type, recordType });
    const profileId = selectedProfile?.id || location.pathname.split("/")[2];
    if (profileId) {
      navigate(`/dash/${profileId}/rules`);
    }
  };

  return {
    isLoggedIn,
    profiles,
    currentUser,
    selectedProfile,
    setSelectedProfile,
    showCreateDialog,
    setShowCreateDialog,
    newProfileName,
    setNewProfileName,
    createError,
    setCreateError,
    prefilledRule,
    setPrefilledRule,
    checkAuthAndFetchData,
    handleCreateProfile,
    handleDeleteProfile,
    handleLogout,
    handleQuickAction,
  };
}
