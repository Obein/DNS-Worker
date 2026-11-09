import React, { useState } from "react";
import {
  Card,
  Elevation,
  H4,
  Button,
  Intent,
  OverlayToaster
} from "@blueprintjs/core";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { clearProfileLogs, localDb } from "../../../services";

export interface ProfileDangerZoneProps {
  profileId: string;
  toasterRef?: React.RefObject<OverlayToaster | null>;
  onLogsCleared?: () => void;
}

/**
 * ProfileDangerZone component mimicking the Danger Zone in /account page.
 * Displays high-risk irreversible actions for the current Profile, such as clearing all profile logs.
 */
export const ProfileDangerZone: React.FC<ProfileDangerZoneProps> = ({
  profileId,
  toasterRef,
  onLogsCleared,
}) => {
  const { t } = useTranslation();
  const [clearingLogs, setClearingLogs] = useState<boolean>(false);

  const handleClearProfileLogs = async () => {
    if (!confirm(t("settings.confirmClearProfileLogs", "确定要清空当前配置的所有查询日志吗？此操作不可恢复。"))) {
      return;
    }
    setClearingLogs(true);
    try {
      await clearProfileLogs(profileId);
      await localDb.clearProfile(profileId).catch(() => {});
      toasterRef?.current?.show({
        message: t("settings.clearProfileLogsSuccess", "配置日志已成功清空"),
        intent: Intent.SUCCESS,
        icon: "tick",
      });
      onLogsCleared?.();
    } catch (e: unknown) {
      console.error("[ProfileDangerZone] Clear profile logs failed:", e);
      const msg = e instanceof Error ? e.message : String(e);
      toasterRef?.current?.show({
        message: msg || t("common.errorNetwork", "网络请求失败"),
        intent: Intent.DANGER,
        icon: "error",
      });
    } finally {
      setClearingLogs(false);
    }
  };

  return (
    <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-gray-800">
      <H4 className="text-red-500 flex items-center gap-2">
        <Trash2 size={20} /> {t("settings.dangerZone", "危险区域")}
      </H4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card elevation={Elevation.ONE} className="flex flex-col justify-between dark:bg-gray-900 dark:border-gray-800">
          <div>
            <H4>{t("settings.clearProfileLogs", "清空所有配置日志")}</H4>
            <p className="text-xs opacity-60 mb-3">
              {t(
                "settings.clearProfileLogsDesc",
                "这将删除当前 DNS 配置生成的所有查询日志（包含服务端日志与本地缓存）。此操作不可恢复。"
              )}
            </p>
          </div>
          <Button
            fill
            intent={Intent.DANGER}
            text={t("settings.clearProfileLogsBtn", "立即清空配置日志")}
            icon="trash"
            loading={clearingLogs}
            onClick={handleClearProfileLogs}
          />
        </Card>
      </div>
    </div>
  );
};
