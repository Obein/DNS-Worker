import React from "react";
import { Card, Elevation, H4, Button, Intent, Callout } from "@blueprintjs/core";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface DangerZoneCardProps {
  isAdmin: boolean;
}

export const DangerZoneCard: React.FC<DangerZoneCardProps> = ({ isAdmin }) => {
  const { t } = useTranslation();

  const handleClearAllLogs = async () => {
    if (!confirm(t("account.confirmClearLogs"))) return;
    try {
      const res = await fetch("/api/account/logs", { method: "DELETE" });
      if (res.ok) alert(t("account.clearLogsSuccess"));
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteMyAccount = async () => {
    if (!confirm(t("account.confirmDeleteAccount"))) return;
    try {
      const res = await fetch("/api/account/me", { method: "DELETE" });
      if (res.ok) {
        window.location.href = "/";
      } else {
        alert(await res.text());
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <>
      <H4 className="text-red-500 flex items-center gap-2">
        <Trash2 size={20} /> {t("account.dangerZone")}
      </H4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card elevation={Elevation.ONE}>
          <H4>{t("account.clearLogs")}</H4>
          <p className="text-xs opacity-60 mb-4">{t("account.clearLogsDesc")}</p>
          <Button
            fill
            intent={Intent.DANGER}
            text={t("account.clearLogsBtn")}
            icon="trash"
            onClick={handleClearAllLogs}
          />
        </Card>
        {!isAdmin && (
          <Card elevation={Elevation.ONE}>
            <H4>{t("account.deleteAccount")}</H4>
            <p className="text-xs opacity-60 mb-4">{t("account.deleteAccountDesc")}</p>
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
