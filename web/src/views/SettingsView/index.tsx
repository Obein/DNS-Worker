import React, { useState, useEffect, useRef, useCallback } from "react";
import { Spinner, Intent } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

import type {  Profile, ProfileSettings, SettingsViewProps, TestResponse  } from "./types";
import { SettingsHeader } from "./components/SettingsHeader";
import { UpstreamCard } from "./components/UpstreamCard";
import { DefaultPolicyCard } from "./components/DefaultPolicyCard";
import { LogRetentionCard } from "./components/LogRetentionCard";
import { AdvancedEcsCard } from "./components/AdvancedEcsCard";
import { BestEffortEchCard } from "./components/BestEffortEchCard";
import { DnsTestCard } from "./components/DnsTestCard";
import {
  getProfileDetails,
  renameProfile,
  updateProfileSettings,
  testResolution,
  getProfileRules
} from "../../services";

export const SettingsView: React.FC<SettingsViewProps> = ({ profileId, toasterRef, currentUser }) => {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<ProfileSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { t } = useTranslation();

  const isInitialLoad = useRef(true);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState("");

  // DNS 测试相关状态
  const [testInput, setTestInput] = useState({
    domain: "o-o.myaddr.l.google.com",
    type: "TXT",
  });
  const [testResult, setTestResult] = useState<TestResponse | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const data = await getProfileDetails(profileId) as any;
        setProfile(data);
        setEditName(data.name);
        setSettings(JSON.parse(data.settings));
        return profile;
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, [profileId]);

  useEffect(() => {
    if (!loading && settings) {
      const timer = setTimeout(() => {
        isInitialLoad.current = false;
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [loading, settings]);

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  const updateProfileName = async () => {
    if (!editName || editName === profile?.name) {
      setIsEditingName(false);
      return;
    }
    try {
      await renameProfile(profileId, editName);
      setProfile((prev) => (prev ? { ...prev, name: editName } : null));
      setIsEditingName(false);
      toasterRef?.current?.show({
        message: t("settings.nameUpdateSuccess", "名称已更新"),
        intent: Intent.SUCCESS,
      });
    } catch (e: any) {
      console.error(e);
      const rawErr = e.message;
      let errMsg = rawErr;
      if (rawErr === "The profile name already exists") {
        errMsg = t("common.profileNameExists", "The profile name already exists");
      } else if (rawErr === "Invalid Profile Name format") {
        errMsg = t("common.profileNameFormatError", "Invalid Profile Name format");
      }
      toasterRef?.current?.show({
        message: errMsg || t("settings.nameUpdateFailed", "更新失败"),
        intent: Intent.DANGER,
      });
    }
  };

  const saveSettings = useCallback(async (settingsToSave: ProfileSettings) => {
    if (!settingsToSave) return;
    setSaving(true);
    try {
      await updateProfileSettings(profileId, settingsToSave as any);
    } catch (e) {
      console.error(e);
      toasterRef?.current?.show({
        message: t("settings.saveError"),
        intent: Intent.DANGER,
        icon: "error",
      });
    } finally {
      setSaving(false);
    }
  }, [profileId, toasterRef, t]);

  const debouncedSave = useCallback(
    (newSettings: ProfileSettings) => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        saveSettings(newSettings);
      }, 600);
    },
    [saveSettings],
  );

  const handleSettingsChange = useCallback(
    (newSettings: ProfileSettings) => {
      setSettings(newSettings);
      if (!isInitialLoad.current) {
        debouncedSave(newSettings);
      }
    },
    [debouncedSave],
  );

  const handleDnsTest = async () => {
    if (!testInput.domain) return;
    setTesting(true);
    setTestResult(null);
    try {
      const data = await testResolution(profileId, testInput);
      setTestResult(data);
    } catch (e) {
      console.error(e);
    } finally {
      setTesting(false);
    }
  };

  const exportProfile = async () => {
    if (!profile || !settings) return;
    try {
      const rules = await getProfileRules(profileId);

      const exportData = {
        version: 1,
        name: profile.name,
        settings: settings,
        rules: rules,
        exported_at: Math.floor(Date.now() / 1000),
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `obex-dns-${profile.name || profileId}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toasterRef?.current?.show({
        message: t("settings.exportSuccess", "配置成功导出"),
        intent: Intent.SUCCESS,
        icon: "download",
      });
    } catch (e) {
      console.error(e);
      toasterRef?.current?.show({
        message: t("settings.exportError", "导出失败"),
        intent: Intent.DANGER,
        icon: "error",
      });
    }
  };

  if (loading || !settings)
    return (
      <div className="p-20 flex justify-center">
        <Spinner />
      </div>
    );

  return (
    <div className="p-0 sm:p-4 lg:p-8 max-w-5xl mx-auto space-y-8 pb-20">
      <SettingsHeader
        profile={profile}
        isEditingName={isEditingName}
        setIsEditingName={setIsEditingName}
        editName={editName}
        setEditName={setEditName}
        updateProfileName={updateProfileName}
        exportProfile={exportProfile}
        saving={saving}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <UpstreamCard settings={settings} setSettings={handleSettingsChange} />
        <DefaultPolicyCard settings={settings} setSettings={handleSettingsChange} />
        <LogRetentionCard settings={settings} setSettings={handleSettingsChange} isAdmin={currentUser?.role === "admin"} maxRetentionDays={currentUser?.max_log_retention_days ?? 7} />
        <AdvancedEcsCard settings={settings} setSettings={handleSettingsChange} />
        <BestEffortEchCard settings={settings} setSettings={handleSettingsChange} />
      </div>

      <DnsTestCard
        testInput={testInput}
        setTestInput={setTestInput}
        handleDnsTest={handleDnsTest}
        testing={testing}
        testResult={testResult}
      />
    </div>
  );
};
