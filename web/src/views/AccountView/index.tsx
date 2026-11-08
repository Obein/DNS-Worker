import React, { useState, useEffect, useCallback } from "react";
import { Divider, Tag, Intent, type OverlayToaster } from "@blueprintjs/core";
import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { clsx } from "clsx";

import type { UserInfo } from "./types";
import {
  getMe,
  updateMe,
} from "../../services";
import { executeWithTimeout } from "../../utils/async";
import { MfaCard } from "./components/MfaCard";
import { ActivityLogCard } from "./components/ActivityLogCard";
import { ActiveSessionsCard } from "./components/ActiveSessionsCard";
import { DangerZoneCard } from "./components/DangerZoneCard";
import { PersonalInfoCard } from "./components/PersonalInfoCard";
import { ChangePasswordCard } from "./components/ChangePasswordCard";
import { SessionLockCard } from "./components/SessionLockCard";
import { UserFilterListsCard } from "./components/UserFilterListsCard";
import { E2eeCard } from "./components/E2eeCard";
import { USERNAME_REGEX } from "../../utils/auth";
import { useIsMobile } from "../../hooks/useIsMobile";

export interface AccountViewProps {
  onSavingChange?: (saving: boolean) => void;
  toasterRef?: React.RefObject<OverlayToaster | null>;
}

/**
 * AccountView serves as the primary dashboard for user settings, profile updates,
 * MFA (Passkey & TOTP) status, active login sessions, security activity logs, and administrative tools
 * (user management, system preferences) for admins.
 *
 * @returns React elements representing the account dashboard view.
 */
export const AccountView: React.FC<AccountViewProps> = ({ onSavingChange, toasterRef }) => {
  const [me, setMe] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const { t, i18n } = useTranslation();
  const isMobile = useIsMobile();

  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [editUsername, setEditUsername] = useState("");
  const [usernameLoading, setUsernameLoading] = useState(false);
  const [usernameFocused, setUsernameFocused] = useState(false);

  const fetchMe = useCallback(async () => {
    try {
      const data = await getMe();
      setMe(data);
      setEditUsername(data.username);
      window.dispatchEvent(new Event("user_updated"));
      if (data.timezone) {
        const { setSystemTimeZone } = await import("../../utils/date");
        setSystemTimeZone(data.timezone);
      }
      if (data.locale) {
        const { setSystemLocale } = await import("../../utils/date");
        setSystemLocale(data.locale);
        i18n.changeLanguage(data.locale);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [i18n]);

  const handleUpdateUsername = async () => {
    if (editUsername === me?.username) {
      setIsEditingUsername(false);
      return;
    }
    if (!USERNAME_REGEX.test(editUsername)) {
      toasterRef?.current?.show({
        message: t("account.formatTipUsername"),
        intent: Intent.WARNING,
        icon: "warning-sign",
      });
      return;
    }
    const previousUsername = me?.username || "";
    const targetUsername = editUsername;
    setUsernameLoading(true);
    onSavingChange?.(true);
    try {
      await executeWithTimeout(updateMe({ username: targetUsername }), 10000);
      setMe((prev) => (prev ? { ...prev, username: targetUsername } : null));
      setIsEditingUsername(false);
      toasterRef?.current?.show({
        message: t("common.saveSuccess", "保存成功"),
        intent: Intent.SUCCESS,
        icon: "tick",
      });
    } catch (e: any) {
      console.error(e);
      // Revert to original username on timeout or error
      setEditUsername(previousUsername);
      setMe((prev) => (prev ? { ...prev, username: previousUsername } : null));
      setIsEditingUsername(false);
      toasterRef?.current?.show({
        message: e.message || t("common.saveFailed", "保存失败"),
        intent: Intent.DANGER,
        icon: "error",
      });
    } finally {
      setUsernameLoading(false);
      onSavingChange?.(false);
    }
  };

  const handleUpdateTimezone = async (newTimezone: string | null) => {
    const previousTimezone = me?.timezone ?? null;
    setMe((prev) => (prev ? { ...prev, timezone: newTimezone } : null));
    onSavingChange?.(true);
    try {
      await executeWithTimeout(updateMe({ timezone: newTimezone || "" }), 10000);
      const { setSystemTimeZone } = await import("../../utils/date");
      setSystemTimeZone(newTimezone || "");
      toasterRef?.current?.show({
        message: t("common.saveSuccess", "保存成功"),
        intent: Intent.SUCCESS,
        icon: "tick",
      });
    } catch (e: any) {
      console.error(e);
      // Revert to original timezone on timeout or error
      setMe((prev) => (prev ? { ...prev, timezone: previousTimezone } : null));
      const { setSystemTimeZone } = await import("../../utils/date");
      setSystemTimeZone(previousTimezone || "");
      toasterRef?.current?.show({
        message: e.message || t("common.saveFailed", "保存失败"),
        intent: Intent.DANGER,
        icon: "error",
      });
    } finally {
      onSavingChange?.(false);
    }
  };

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  if (loading)
    return <div className="p-8 text-center">{t("common.loading")}</div>;

  return (
    <div className={clsx("max-w-5xl mx-auto space-y-8", isMobile ? "p-0" : "px-8")}>
      <div className="flex justify-between items-start sm:items-end gap-3 flex-wrap sm:flex-nowrap">
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
            className="shrink-0 whitespace-nowrap"
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

        <ChangePasswordCard me={me} onRefresh={fetchMe} />
      </div>

      {/* MFA: TOTP & Passkeys */}
      {me && <MfaCard user={me} onRefresh={fetchMe} />}

      {/* End-to-End Encryption (E2EE) */}
      {me && <E2eeCard user={me} onRefresh={fetchMe} />}

      {/* Session Lock */}
      {me && (
        <SessionLockCard
          user={me}
          onRefresh={fetchMe}
          onSavingChange={onSavingChange}
          toasterRef={toasterRef}
        />
      )}

      {/* User-level Filter Lists */}
      {me && (
        <UserFilterListsCard
          onSavingChange={onSavingChange}
          toasterRef={toasterRef}
        />
      )}

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

      {/* Danger Zone */}
      <Divider />
      <div className="space-y-4">
        <DangerZoneCard
          isAdmin={me?.role === "admin"}
          user={me}
        />
      </div>
    </div>
  );
};
