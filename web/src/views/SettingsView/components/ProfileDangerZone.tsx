import React, { useState } from "react";
import {
  Card,
  Elevation,
  H4,
  Button,
  Intent,
  Collapse,
  OverlayToaster
} from "@blueprintjs/core";
import { Trash2, ChevronDown } from "lucide-react";
import { clsx } from "clsx";
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
 * Includes collapsible section behavior, defaulting to collapsed.
 */
export const ProfileDangerZone: React.FC<ProfileDangerZoneProps> = ({
  profileId,
  toasterRef,
  onLogsCleared,
}) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState<boolean>(false);
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
      <div
        className="flex items-center justify-between cursor-pointer select-none py-1 group"
        onClick={() => setIsOpen(!isOpen)}
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setIsOpen(!isOpen);
          }
        }}
      >
        <H4 className="text-red-500 flex items-center gap-2 m-0! group-hover:text-red-600 dark:group-hover:text-red-400 transition-colors">
          <Trash2 size={20} /> {t("settings.dangerZone", "危险区域")}
        </H4>
        <Button
          variant="minimal"
          icon={<ChevronDown size={18} className={clsx("transition-transform duration-200 text-red-500", !isOpen && "-rotate-90")} />}
          text={isOpen ? t("common.collapse", "收起") : t("common.expand", "展开")}
          className="text-red-500 hover:text-red-600 dark:hover:text-red-400"
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(!isOpen);
          }}
          aria-label={isOpen ? t("common.collapse", "收起") : t("common.expand", "展开")}
        />
      </div>

      <Collapse isOpen={isOpen} keepChildrenMounted>
        <div className="space-y-4 pt-3">
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
      </Collapse>
    </div>
  );
};
