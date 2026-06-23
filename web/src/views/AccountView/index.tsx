import React, { useState, useEffect, useCallback } from "react";
import { Divider, Tag, Intent } from "@blueprintjs/core";
import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { clsx } from "clsx";
import { hashPasswordClient } from "../../utils/auth";

import type { UserInfo } from "./types";
import {
  getUsers,
  getSystemSettings,
  getMe,
  updateMe,
  updatePassword
} from "../../services";
import { TOTPCard } from "./components/TOTPCard";
import { ActivityLogCard } from "./components/ActivityLogCard";
import { ActiveSessionsCard } from "./components/ActiveSessionsCard";
import { UserManagementCard } from "./components/UserManagementCard";
import { SystemSettingsCard } from "./components/SystemSettingsCard";
import { DangerZoneCard } from "./components/DangerZoneCard";
import { PersonalInfoCard } from "./components/PersonalInfoCard";
import { ChangePasswordCard } from "./components/ChangePasswordCard";
import { SessionLockCard } from "./components/SessionLockCard";
import { PASSWORD_REGEX, USERNAME_REGEX } from "../../utils/auth";
import { useIsMobile } from "../../hooks/useIsMobile";

/**
 * AccountView serves as the primary dashboard for user settings, profile updates,
 * 2FA status, active login sessions, security activity logs, and administrative tools
 * (user management, system preferences) for admins.
 *
 * @returns React elements representing the account dashboard view.
 */
export const AccountView: React.FC = () => {
  const [me, setMe] = useState<UserInfo | null>(null);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const { t, i18n } = useTranslation();
  const isMobile = useIsMobile();

  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [editUsername, setEditUsername] = useState("");
  const [usernameLoading, setUsernameLoading] = useState(false);
  const [usernameFocused, setUsernameFocused] = useState(false);

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordFocused, setNewPasswordFocused] = useState(false);
  const [useTotpForPw, setUseTotpForPw] = useState(false);
  const [totpToken, setTotpToken] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMessage, setPwMessage] = useState<{
    text: string;
    intent: Intent;
  } | null>(null);

  const [sysSettings, setSysSettings] = useState<Record<string, string>>({});

  const fetchUsers = async () => {
    try {
      const data = await getUsers() as UserInfo[];
      setUsers(data);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchSystemSettings = async () => {
    try {
      const settings = await getSystemSettings();
      setSysSettings(settings);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchMe = useCallback(async () => {
    try {
      const data = await getMe();
      setMe(data);
      setEditUsername(data.username);
      if (data.timezone) {
        const { setSystemTimeZone } = await import("../../utils/date");
        setSystemTimeZone(data.timezone);
      }
      if (data.locale) {
        const { setSystemLocale } = await import("../../utils/date");
        setSystemLocale(data.locale);
        i18n.changeLanguage(data.locale);
      }
      if (data.role === "admin") {
        fetchUsers();
        fetchSystemSettings();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleUpdateUsername = async () => {
    if (editUsername === me?.username) {
      setIsEditingUsername(false);
      return;
    }
    if (!USERNAME_REGEX.test(editUsername)) {
      alert(t("account.formatTipUsername"));
      return;
    }
    setUsernameLoading(true);
    try {
      await updateMe({ username: editUsername });
      setMe((prev) => (prev ? { ...prev, username: editUsername } : null));
      setIsEditingUsername(false);
    } catch (e: any) {
      console.error(e);
      alert(e.message || t("common.errorNetwork"));
    } finally {
      setUsernameLoading(false);
    }
  };

  const handleUpdateTimezone = async (newTimezone: string | null) => {
    try {
      await updateMe({ timezone: newTimezone || "" });
      setMe((prev) => (prev ? { ...prev, timezone: newTimezone } : null));
      const { setSystemTimeZone } = await import("../../utils/date");
      setSystemTimeZone(newTimezone || "");
    } catch (e: any) {
      console.error(e);
      alert(e.message || t("common.errorNetwork"));
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!PASSWORD_REGEX.test(newPassword)) {
      setPwMessage({
        text: t("account.formatTipPassword"),
        intent: Intent.DANGER
      });
      return;
    }
    setPwLoading(true);
    setPwMessage(null);
    try {
      let tokenPayload = useTotpForPw ? totpToken : undefined;
      let saltPayload: string | undefined = undefined;

      if (useTotpForPw && totpToken) {
        saltPayload = crypto.randomUUID();
        const msgBuffer = new TextEncoder().encode(totpToken + saltPayload);
        const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
        tokenPayload = Array.from(new Uint8Array(hashBuffer))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      }

      if (!me) throw new Error("User information not loaded");

      let oldPasswordPayload = oldPassword;
      if (!useTotpForPw && oldPassword) {
        if ((me.password_version ?? 1) === 2) {
          oldPasswordPayload = await hashPasswordClient(oldPassword, me.username);
        }
      }

      const newPasswordPayload = await hashPasswordClient(newPassword, me.username);

      await updatePassword({
        oldPassword: useTotpForPw ? undefined : oldPasswordPayload,
        totpTokenHash: tokenPayload,
        totpSalt: saltPayload,
        newPassword: newPasswordPayload
      });

      setPwMessage({
        text: t("account.passwordSuccess"),
        intent: Intent.SUCCESS
      });
      setOldPassword("");
      setNewPassword("");
    } catch (e: any) {
      setPwMessage({
        text: e.message || t("account.updateFailed"),
        intent: Intent.DANGER
      });
    } finally {
      setPwLoading(false);
    }
  };

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  if (loading)
    return <div className="p-8 text-center">{t("common.loading")}</div>;

  return (
    <div className={clsx("max-w-5xl mx-auto space-y-8", isMobile ? "p-0" : "p-8")}>
      <div className="flex justify-between items-end">
        <div>
          <h2 className="bp6-heading">{t("account.title")}</h2>
          <p className="bp6-text-muted">{t("account.subtitle")}</p>
        </div>
        {me && (
          <Tag
            large
            round
            intent={me.role === "admin" ? Intent.DANGER : Intent.PRIMARY}
            icon={<ShieldCheck size={16} />}
          >
            {me.role === "admin" ? t("account.roleAdmin") : t("account.roleUser")}
          </Tag>
        )}
      </div>

      {/* Personal Info + Password */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <PersonalInfoCard
          me={me}
          isEditingUsername={isEditingUsername}
          setIsEditingUsername={setIsEditingUsername}
          editUsername={editUsername}
          setEditUsername={setEditUsername}
          usernameLoading={usernameLoading}
          usernameFocused={usernameFocused}
          setUsernameFocused={setUsernameFocused}
          onUpdateUsername={handleUpdateUsername}
          onUpdateTimezone={handleUpdateTimezone}
        />

        <ChangePasswordCard
          me={me}
          useTotpForPw={useTotpForPw}
          setUseTotpForPw={setUseTotpForPw}
          totpToken={totpToken}
          setTotpToken={setTotpToken}
          oldPassword={oldPassword}
          setOldPassword={setOldPassword}
          newPassword={newPassword}
          setNewPassword={setNewPassword}
          newPasswordFocused={newPasswordFocused}
          setNewPasswordFocused={setNewPasswordFocused}
          pwLoading={pwLoading}
          pwMessage={pwMessage}
          onClearMessage={() => setPwMessage(null)}
          onSubmit={handleChangePassword}
        />
      </div>

      {/* TOTP 2FA */}
      {me && <TOTPCard user={me} onRefresh={fetchMe} />}

      {/* Session Lock */}
      {me && <SessionLockCard user={me} onRefresh={fetchMe} />}

      {/* Active Sessions */}
      {me && (
        <ActiveSessionsCard
          hoveredSessionId={hoveredSessionId}
          setHoveredSessionId={setHoveredSessionId}
        />
      )}

      {/* Activity Log */}
      {me && (
        <ActivityLogCard
          hoveredSessionId={hoveredSessionId}
          setHoveredSessionId={setHoveredSessionId}
        />
      )}

      {/* Admin: User Management */}
      {me?.role === "admin" && (
        <>
          <Divider />
          <div className="space-y-4">
            <UserManagementCard
              users={users}
              currentUserId={me.id}
              onRefresh={fetchUsers}
            />
          </div>

          <Divider />
          <div className="space-y-4">
            <SystemSettingsCard
              initialSettings={sysSettings}
              onRefresh={fetchSystemSettings}
            />
          </div>
        </>
      )}

      {/* Danger Zone */}
      <Divider />
      <div className="space-y-4">
        <DangerZoneCard isAdmin={me?.role === "admin"} />
      </div>
    </div>
  );
};
