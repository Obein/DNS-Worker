import React, { useState, useEffect, useCallback } from "react";
import { Card, Elevation, H4, Button, Intent, Callout, Tag, Spinner } from "@blueprintjs/core";
import { Trash2, Database } from "lucide-react";
import { useTranslation } from "react-i18next";
import { clearLogs, deleteMe, getDatabaseSize, type DatabaseSizeInfo } from "../../../services";

export interface DangerZoneCardProps {
  isAdmin: boolean;
}

export const DangerZoneCard: React.FC<DangerZoneCardProps> = ({ isAdmin }) => {
  const { t } = useTranslation();
  const [dbSize, setDbSize] = useState<DatabaseSizeInfo | null>(null);
  const [loadingSize, setLoadingSize] = useState<boolean>(true);
  const [clearingLogs, setClearingLogs] = useState<boolean>(false);

  const fetchDbSize = useCallback(async () => {
    setLoadingSize(true);
    try {
      const data = await getDatabaseSize();
      setDbSize(data);
    } catch (e) {
      console.error("Failed to fetch database size:", e);
    } finally {
      setLoadingSize(false);
    }
  }, []);

  useEffect(() => {
    fetchDbSize();
  }, [fetchDbSize]);

  const handleClearAllLogs = async () => {
    if (!confirm(t("account.confirmClearLogs"))) return;
    setClearingLogs(true);
    try {
      await clearLogs();
      alert(t("account.clearLogsSuccess"));
      await fetchDbSize();
    } catch (e) {
      console.error(e);
    } finally {
      setClearingLogs(false);
    }
  };

  const handleDeleteMyAccount = async () => {
    if (!confirm(t("account.confirmDeleteAccount"))) return;
    try {
      await deleteMe();
      window.location.href = "/";
    } catch (e: any) {
      console.error(e);
      alert(e.message || t("common.errorNetwork"));
    }
  };

  return (
    <>
      <H4 className="text-red-500 flex items-center gap-2">
        <Trash2 size={20} /> {t("account.dangerZone")}
      </H4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card elevation={Elevation.ONE} className="flex flex-col justify-between">
          <div>
            <H4>{t("account.clearLogs")}</H4>
            <p className="text-xs opacity-60 mb-3">{t("account.clearLogsDesc")}</p>
            <div className="flex items-center justify-between p-2.5 mb-4 bg-gray-50 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2 text-xs">
                <Database size={15} className="text-gray-500 flex-shrink-0" />
                <span className="text-gray-700 dark:text-gray-300 font-medium">
                  {t("account.currentDbSize")}:
                </span>
                {loadingSize ? (
                  <Spinner size={14} />
                ) : (
                  <Tag
                    minimal
                    round
                    intent={Intent.PRIMARY}
                    className="font-mono font-semibold"
                  >
                    {dbSize?.formatted || "0 B"}
                  </Tag>
                )}
              </div>
              <Button
                minimal
                small
                icon="refresh"
                loading={loadingSize}
                onClick={fetchDbSize}
                title={t("common.refresh") || "Refresh"}
              />
            </div>
          </div>
          <Button
            fill
            intent={Intent.DANGER}
            text={t("account.clearLogsBtn")}
            icon="trash"
            loading={clearingLogs}
            onClick={handleClearAllLogs}
          />
        </Card>
        {!isAdmin && (
          <Card elevation={Elevation.ONE} className="flex flex-col justify-between">
            <div>
              <H4>{t("account.deleteAccount")}</H4>
              <p className="text-xs opacity-60 mb-4">{t("account.deleteAccountDesc")}</p>
            </div>
            <Button
              fill
              intent={Intent.DANGER}
              text={t("account.deleteAccountBtn")}
              icon="delete"
              onClick={handleDeleteMyAccount}
            />
          </Card>
        )}
      </div>
      <Callout intent={Intent.WARNING} icon="info-sign" title={t("account.inactivityPolicy")}>
        <p className="text-sm">{t("account.inactivityDesc")}</p>
      </Callout>
    </>
  );
};
