import React, { useState, useEffect, useCallback } from "react";
import { Divider, Tag, Intent, Callout, H5, type OverlayToaster } from "@blueprintjs/core";
import { ShieldCheck, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { clsx } from "clsx";

import type { UserInfo } from "../AccountView/types";
import {
  getUsers,
  getSystemSettings,
  getMe,
  getDatabaseStatus,
  type DatabaseStatusResponse
} from "../../services";
import { UserManagementCard } from "./components/UserManagementCard";
import { DistributeFilterCard } from "./components/DistributeFilterCard";
import { SystemSettingsCard } from "./components/SystemSettingsCard";
import { DatabaseMigrationCard } from "./components/DatabaseMigrationCard";
import { useIsMobile } from "../../hooks/useIsMobile";

export interface SystemViewProps {
  onSavingChange?: (saving: boolean) => void;
  toasterRef?: React.RefObject<OverlayToaster | null>;
}

/**
 * SystemView provides an administrative console for managing users, system-level filter lists,
 * global application settings, and database migrations/maintenance.
 *
 * @returns React element representing the system administration view.
 */
export const SystemView: React.FC<SystemViewProps> = ({ onSavingChange, toasterRef }) => {
  const [me, setMe] = useState<UserInfo | null>(null);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  const [sysSettings, setSysSettings] = useState<Record<string, string>>({});
  const [dbStatus, setDbStatus] = useState<DatabaseStatusResponse | null>(null);

  const fetchUsers = async () => {
    try {
      const data = (await getUsers()) as UserInfo[];
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

  const fetchDbStatus = useCallback(async () => {
    try {
      const status = await getDatabaseStatus();
      setDbStatus(status);
    } catch (e) {
      console.error("Failed to fetch database status:", e);
    }
  }, []);

  const fetchMe = useCallback(async () => {
    try {
      const data = await getMe();
      setMe(data);
      if (data.role === "admin") {
        fetchUsers();
        fetchSystemSettings();
        fetchDbStatus();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [fetchDbStatus]);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  if (loading) {
    return <div className="p-8 text-center">{t("common.loading", "加载中...")}</div>;
  }

  if (me?.role !== "admin") {
    return (
      <div className={clsx("max-w-5xl mx-auto space-y-6", isMobile ? "p-0" : "px-8")}>
        <Callout intent={Intent.DANGER} icon="error" title={t("system.accessDenied", "访问受限")}>
          {t("system.accessDeniedDesc", "当前页面仅限管理员访问。")}
        </Callout>
      </div>
    );
  }

  return (
    <div className={clsx("max-w-5xl mx-auto space-y-8", isMobile ? "p-0" : "px-8")}>
      <div className="flex justify-between items-start sm:items-end gap-3 flex-wrap sm:flex-nowrap">
        <div>
          <h2 className="bp6-heading">{t("system.title", "系统管理")}</h2>
          <p className="bp6-text-muted">
            {t("system.subtitle", "管理用户、系统过滤列表、系统配置与数据库维护")}
          </p>
        </div>
        <Tag
          large
          round
          intent={Intent.DANGER}
          icon={<ShieldCheck size={16} />}
          className="shrink-0 whitespace-nowrap"
        >
          {t("account.roleAdmin", "管理员")}
        </Tag>
      </div>

      {/* Non-blocking Security Warning for Weak JWT_SECRET (Admin only) */}
      {me?.jwt_secret_warning && (
        <Callout intent={Intent.WARNING} icon={null}>
          <H5 className="flex items-center gap-2 mb-1 font-semibold">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{t("account.jwtSecretWarningTitle")}</span>
          </H5>
          <div className="text-sm leading-relaxed mt-1">
            {t("account.jwtSecretWarningDesc")}
          </div>
        </Callout>
      )}

      {/* Admin: User Management */}
      <div className="space-y-4">
        <UserManagementCard
          users={users}
          currentUserId={me.id}
          onRefresh={fetchUsers}
          registrationEnabled={sysSettings.registration_enabled !== "false"}
          maxUsers={sysSettings.max_users}
          onRefreshSettings={fetchSystemSettings}
          onSavingChange={onSavingChange}
          toasterRef={toasterRef}
        />
      </div>

      {/* Admin: System Filter Lists (Admin) */}
      <Divider />
      <div className="space-y-4">
        <DistributeFilterCard
          onSavingChange={onSavingChange}
          toasterRef={toasterRef}
        />
      </div>

      {/* Admin: System Settings */}
      <Divider />
      <div className="space-y-4">
        <SystemSettingsCard
          initialSettings={sysSettings}
          onRefresh={fetchSystemSettings}
          onSavingChange={onSavingChange}
          toasterRef={toasterRef}
        />
      </div>

      {/* Admin: Database Management (Shown for all database types) */}
      <Divider />
      <div className="space-y-4">
        <DatabaseMigrationCard
          status={dbStatus}
          onRefresh={fetchDbStatus}
          toasterRef={toasterRef}
        />
      </div>
    </div>
  );
};
