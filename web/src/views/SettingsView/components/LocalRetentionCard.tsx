import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  Elevation,
  H5,
  FormGroup,
  HTMLSelect,
  Button,
  Intent,
  Tag,
  Alert,
  OverlayToaster
} from "@blueprintjs/core";
import { Database, HardDrive, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { localDb } from "../../../services";

export interface LocalRetentionCardProps {
  profileId: string;
  toasterRef?: React.RefObject<OverlayToaster | null>;
}

/**
 * LocalRetentionCard allows users to configure client-side SQLite log persistence,
 * view local cache storage status (OPFS vs in-memory), and purge local cached logs.
 */
export const LocalRetentionCard: React.FC<LocalRetentionCardProps> = ({ profileId, toasterRef }) => {
  const { t } = useTranslation();
  const [retentionDays, setRetentionDays] = useState<number>(() => localDb.getLocalRetentionDays());
  const [isOpfs, setIsOpfs] = useState<boolean>(false);
  const [rowCount, setRowCount] = useState<number | null>(null);
  const [isAlertOpen, setIsAlertOpen] = useState<boolean>(false);
  const [clearing, setClearing] = useState<boolean>(false);

  const loadStorageInfo = useCallback(async () => {
    try {
      await localDb.init();
      setIsOpfs(localDb.getIsOpfs());
      const info = await localDb.getStorageInfo();
      const profileStat = info.profileStats.find((s) => s.profile_id === profileId);
      setRowCount(profileStat ? profileStat.count : 0);
    } catch (err) {
      console.error("[LocalRetentionCard] Failed to load storage info:", err);
      setRowCount(0);
    }
  }, [profileId]);

  useEffect(() => {
    loadStorageInfo();
  }, [loadStorageInfo]);

  const handleRetentionChange = (days: number) => {
    setRetentionDays(days);
    localDb.setLocalRetentionDays(days);
    loadStorageInfo();
  };

  const handleClearConfirm = async () => {
    setClearing(true);
    try {
      await localDb.clearProfile(profileId);
      setRowCount(0);
      toasterRef?.current?.show({
        message: t("settings.clearLocalDataSuccess", "本地日志已成功清空"),
        intent: Intent.SUCCESS,
        icon: "tick",
      });
    } catch (err) {
      console.error("[LocalRetentionCard] Failed to clear local profile logs:", err);
      toasterRef?.current?.show({
        message: t("settings.clearLocalDataError", "清空本地日志失败"),
        intent: Intent.DANGER,
        icon: "error",
      });
    } finally {
      setClearing(false);
      setIsAlertOpen(false);
    }
  };

  return (
    <Card elevation={Elevation.ONE} className="dark:bg-gray-900 dark:border-gray-800">
      <H5 className="flex items-center gap-2 mb-4 font-bold">
        <Database size={18} className="text-cyan-500" /> {t("settings.localRetentionTitle", "本地存储与留存")}
      </H5>
      <div className="space-y-4">
        <FormGroup label={t("settings.localRetentionDuration", "本地保留时长")}>
          <HTMLSelect
            fill
            value={retentionDays}
            onChange={(e) => handleRetentionChange(parseInt(e.target.value, 10))}
          >
            <option value={30}>{t("settings.localRetention30d", "30 天")}</option>
            <option value={90}>{t("settings.localRetention90d", "90 天 (推荐)")}</option>
            <option value={180}>{t("settings.localRetention180d", "180 天")}</option>
            <option value={365}>{t("settings.localRetention365d", "365 天 (1 年)")}</option>
            <option value={0}>{t("settings.localRetentionUnlimited", "永久保留 (直到手动清除)")}</option>
          </HTMLSelect>
        </FormGroup>

        <p className="text-xs opacity-60">
          {t(
            "settings.localRetentionDesc",
            "日志将持久化保存在当前浏览器本地的 SQLite 数据库 (OPFS) 中，提供秒级本地搜索并节省云端存储费用。超出此时长的本地日志将自动清除。"
          )}
        </p>

        <div className="pt-3 border-t border-gray-100 dark:border-gray-800/80 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 opacity-70">
              <HardDrive size={14} />
              {t("settings.localEngineStorage", "存储引擎")}:
            </span>
            <Tag
              minimal
              intent={isOpfs ? Intent.SUCCESS : Intent.WARNING}
              className="text-[11px]"
            >
              {isOpfs
                ? t("settings.localEngineOpfs", "OPFS 本地持久化")
                : t("settings.localEngineMemory", "内存临时存储 (无痕/私密模式)")}
            </Tag>
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="opacity-70">{t("settings.localCachedCount", "本地已缓存日志")}:</span>
            <span className="font-mono font-medium">
              {rowCount !== null
                ? t("settings.localCachedCountUnit", "{{count}} 条记录", { count: rowCount })
                : "..."}
            </span>
          </div>

          <div className="pt-1 flex justify-end">
            <Button
              minimal
              small
              intent={Intent.DANGER}
              icon={<Trash2 size={13} />}
              text={t("settings.clearLocalData", "清空本地日志")}
              disabled={rowCount === 0 || rowCount === null || clearing}
              onClick={() => setIsAlertOpen(true)}
            />
          </div>
        </div>
      </div>

      <Alert
        isOpen={isAlertOpen}
        confirmButtonText={t("common.confirm", "确认清空")}
        cancelButtonText={t("common.cancel", "取消")}
        intent={Intent.DANGER}
        icon="trash"
        onConfirm={handleClearConfirm}
        onCancel={() => setIsAlertOpen(false)}
        loading={clearing}
      >
        <p>
          {t(
            "settings.clearLocalDataConfirm",
            "确定要清空此配置在本地保存的所有日志吗？（云端日志不受影响）"
          )}
        </p>
      </Alert>
    </Card>
  );
};
