import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useLocation } from "react-router-dom";
import {
  getProfiles,
  createProfile,
  deleteProfile,
  ApiError
} from "../services";
import type { Profile } from "../services";

interface PrefilledRule {
  domain: string;
  type: "ALLOW" | "BLOCK" | "REDIRECT";
  recordType?: string;
}

/**
 * Custom hook managing profiles list, selected profile,
 * dialog states, prefilled rules, and profile CRUD operations.
 *
 * @param isLoggedIn - Auth status from useAuth hook.
 */
export function useProfiles(isLoggedIn: boolean | null) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Profile creation states
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [createError, setCreateError] = useState("");

  // Quick Action / Prefilled Rule states
  const [prefilledRule, setPrefilledRule] = useState<PrefilledRule | null>(null);

  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();

  const fetchProfiles = async () => {
    try {
      const profilesData = await getProfiles();
      setProfiles(profilesData);
    } catch (err) {
      console.error("Failed to fetch profiles", err);
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    if (isLoggedIn === true) {
      fetchProfiles();
    } else {
      setProfiles([]);
      setSelectedProfile(null);
      setLoaded(false);
    }
  }, [isLoggedIn]);

  // 每次导航回 /dash（包括从 Account 页面返回）时重新拉取列表
  useEffect(() => {
    if (isLoggedIn === true && location.pathname === "/dash") {
      fetchProfiles();
    }
  }, [location.pathname]);

  const handleCreateProfile = async () => {
    if (!newProfileName) return;
    try {
      await createProfile(newProfileName);
      setNewProfileName("");
      setShowCreateDialog(false);
      await fetchProfiles();
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
      await fetchProfiles();
      if (selectedProfile?.id === id) {
        setSelectedProfile(null);
      }
    } catch (err) {
      console.error(err);
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
    profiles,
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
    fetchProfiles,
    handleCreateProfile,
    handleDeleteProfile,
    handleQuickAction,
    loaded,
  };
}
