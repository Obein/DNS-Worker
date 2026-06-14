import React, { useState, useEffect } from "react";
import { Spinner, Intent } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

import type {  Profile, ProfileSettings, SettingsViewProps, TestResponse  } from "./types";
import { SettingsHeader } from "./components/SettingsHeader";
import { UpstreamCard } from "./components/UpstreamCard";
import { DefaultPolicyCard } from "./components/DefaultPolicyCard";
import { LogRetentionCard } from "./components/LogRetentionCard";
import { AdvancedEcsCard } from "./components/AdvancedEcsCard";
import { DnsTestCard } from "./components/DnsTestCard";

export const SettingsView: React.FC<SettingsViewProps> = ({ profileId, toasterRef }) => {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<ProfileSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { t } = useTranslation();

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
        const res = await fetch(`/api/profiles/${profileId}`);
        const data = await res.json();
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

  const updateProfileName = async () => {
    if (!editName || editName === profile?.name) {
      setIsEditingName(false);
      return;
    }
    try {
      const res = await fetch(`/api/profiles/${profileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName }),
      });
      if (res.ok) {
        setProfile((prev) => (prev ? { ...prev, name: editName } : null));
        setIsEditingName(false);
        toasterRef?.current?.show({
          message: t("settings.nameUpdateSuccess", "名称已更新"),
          intent: Intent.SUCCESS,
        });
      } else {
        const rawErr = await res.text();
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
    } catch (e) {
      console.error(e);
    }
  };

  const saveSettings = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/profiles/${profileId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        toasterRef?.current?.show({
          message: t("settings.saveSuccess"),
          intent: Intent.SUCCESS,
          icon: "tick",
        });
      } else {
        throw new Error("Failed to save");
      }
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
  };



  const handleDnsTest = async () => {
    if (!testInput.domain) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/profiles/${profileId}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(testInput),
      });
      const data = await res.json();
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
      const resRules = await fetch(`/api/profiles/${profileId}/rules`);
      const rules = resRules.ok ? await resRules.json() : [];

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
    <div className="p-8 max-w-5xl mx-auto space-y-8 pb-20">
      <SettingsHeader
        profile={profile}
        isEditingName={isEditingName}
        setIsEditingName={setIsEditingName}
        editName={editName}
        setEditName={setEditName}
        updateProfileName={updateProfileName}
        exportProfile={exportProfile}
        saveSettings={saveSettings}
        saving={saving}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <UpstreamCard settings={settings} setSettings={setSettings} />
        <DefaultPolicyCard settings={settings} setSettings={setSettings} />
        <LogRetentionCard settings={settings} setSettings={setSettings} />
        <AdvancedEcsCard settings={settings} setSettings={setSettings} />
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
