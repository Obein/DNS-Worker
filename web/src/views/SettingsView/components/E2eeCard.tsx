import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  Elevation,
  H5,
  Switch,
  Button,
  Intent,
  Tag,
  Callout,
  Alert,
  OverlayToaster,
  Spinner
} from "@blueprintjs/core";
import { Lock, ShieldCheck, KeyRound, ExternalLink, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { e2ee } from "../../../services";
import type { ProfileE2eeStatus } from "../../../services";

export interface E2eeCardProps {
  profileId: string;
  toasterRef?: React.RefObject<OverlayToaster | null>;
}

/**
 * E2eeCard manages End-to-End Encryption (E2EE) for DNS query logs.
 * Enforces Passkey requirement, generates ECDH P-256 keypairs, and handles envelope wrapping.
 */
export const E2eeCard: React.FC<E2eeCardProps> = ({ profileId, toasterRef }) => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ProfileE2eeStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [processing, setProcessing] = useState<boolean>(false);
  const [isDisableAlertOpen, setIsDisableAlertOpen] = useState<boolean>(false);
  const [isUnlocked, setIsUnlocked] = useState<boolean>(false);

  const loadStatus = useCallback(async () => {
    try {
      const data = await e2ee.getStatus(profileId);
      setStatus(data);
      setIsUnlocked(e2ee.isProfileUnlocked(profileId));
    } catch (err) {
      console.error("[E2eeCard] Failed to fetch E2EE status:", err);
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleToggle = async (checked: boolean) => {
    if (checked) {
      // Enable E2EE
      setProcessing(true);
      try {
        const passkeyId = status?.wrappedPasskeys[0] || "primary";
        await e2ee.enableE2ee(profileId, passkeyId);
        toasterRef?.current?.show({
          message: t("settings.e2eeEnableSuccess", "端到端加密已成功启用"),
          intent: Intent.SUCCESS,
          icon: "lock",
        });
        await loadStatus();
      } catch (err: any) {
        console.error("[E2eeCard] Failed to enable E2EE:", err);
        toasterRef?.current?.show({
          message: err.message || t("settings.e2eeEnableError", "启用端到端加密失败"),
          intent: Intent.DANGER,
          icon: "error",
        });
      } finally {
        setProcessing(false);
      }
    } else {
      // Prompt confirm to disable
      setIsDisableAlertOpen(true);
    }
  };

  const handleConfirmDisable = async () => {
    setProcessing(true);
    try {
      await e2ee.disableE2ee(profileId);
      toasterRef?.current?.show({
        message: t("settings.e2eeDisableSuccess", "端到端加密已关闭"),
        intent: Intent.WARNING,
        icon: "unlock",
      });
      await loadStatus();
    } catch (err: any) {
      console.error("[E2eeCard] Failed to disable E2EE:", err);
      toasterRef?.current?.show({
        message: err.message || t("settings.e2eeDisableError", "关闭端到端加密失败"),
        intent: Intent.DANGER,
        icon: "error",
      });
    } finally {
      setProcessing(false);
      setIsDisableAlertOpen(false);
    }
  };

  const handleUnlock = async () => {
    setProcessing(true);
    try {
      const success = await e2ee.unlockProfile(profileId);
      if (success) {
        setIsUnlocked(true);
        toasterRef?.current?.show({
          message: t("settings.e2eeUnlockSuccess", "私钥已成功在此设备解锁"),
          intent: Intent.SUCCESS,
          icon: "tick",
        });
      }
    } catch (err: any) {
      console.error("[E2eeCard] Failed to unlock private key:", err);
      toasterRef?.current?.show({
        message: err.message || t("settings.e2eeUnlockError", "验证 Passkey 解锁失败"),
        intent: Intent.DANGER,
        icon: "error",
      });
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <Card elevation={Elevation.ONE} className="dark:bg-gray-900 dark:border-gray-800 flex items-center justify-center p-8">
        <Spinner size={24} />
      </Card>
    );
  }

  const hasPasskey = (status?.userPasskeyCount || 0) > 0;
  const isEnabled = Boolean(status?.enabled);

  return (
    <Card elevation={Elevation.ONE} className="dark:bg-gray-900 dark:border-gray-800">
      <div className="flex items-center justify-between mb-4">
        <H5 className="flex items-center gap-2 mb-0 font-bold">
          <Lock size={18} className="text-emerald-500" /> {t("settings.e2eeTitle", "日志端到端加密 (E2EE)")}
        </H5>
        <Tag
          minimal
          intent={isEnabled ? Intent.SUCCESS : Intent.NONE}
          className="text-[11px]"
        >
          {isEnabled ? t("settings.e2eeEnabled", "已启用") : t("settings.e2eeDisabled", "未启用")}
        </Tag>
      </div>

      <div className="space-y-4">
        <p className="text-xs opacity-60">
          {t(
            "settings.e2eeDesc",
            "使用您专属的 ECDH P-256 密钥在边缘 Worker 处即刻加密 DNS 日志。云端无法窥视，数据仅在通过您的硬件 Passkey 授权的客户端本地解密并分析。"
          )}
        </p>

        {!hasPasskey ? (
          <Callout intent={Intent.WARNING} icon="key" className="text-xs">
            <div className="space-y-2">
              <p>
                {t(
                  "settings.e2eePasskeyRequired",
                  "端到端加密需要硬件 Passkey (WebAuthn) 支持。检测到您尚未在账号中绑定 Passkey，请先在「账号设置」中添加 Passkey。"
                )}
              </p>
              <Button
                small
                outlined
                intent={Intent.PRIMARY}
                icon={<ExternalLink size={13} />}
                text={t("settings.e2eeGoToAccount", "前往账号设置添加 Passkey")}
                onClick={() => {
                  window.location.hash = "#/account";
                }}
              />
            </div>
          </Callout>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between pt-2">
              <span className="text-sm font-medium">
                {t("settings.e2eeEnableSwitch", "启用日志端到端加密")}
              </span>
              <Switch
                large
                checked={isEnabled}
                disabled={processing}
                onChange={(e) => handleToggle(e.currentTarget.checked)}
                className="mb-0"
              />
            </div>

            {isEnabled && (
              <div className="pt-3 border-t border-gray-100 dark:border-gray-800/80 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="opacity-70 flex items-center gap-1.5">
                    <KeyRound size={13} />
                    {t("settings.e2eeKeyType", "加密算法")}:
                  </span>
                  <span className="font-mono">ECDH P-256 + AES-256-GCM</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="opacity-70 flex items-center gap-1.5">
                    <ShieldCheck size={13} />
                    {t("settings.e2eeDeviceState", "当前设备状态")}:
                  </span>
                  {isUnlocked ? (
                    <Tag minimal intent={Intent.SUCCESS} className="text-[10px]">
                      {t("settings.e2eeUnlocked", "已在此设备解锁")}
                    </Tag>
                  ) : (
                    <Button
                      small
                      minimal
                      intent={Intent.PRIMARY}
                      icon={<RefreshCw size={12} />}
                      text={t("settings.e2eeUnlockButton", "验证 Passkey 解锁")}
                      loading={processing}
                      onClick={handleUnlock}
                    />
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <span className="opacity-70">{t("settings.e2eeProtectedPasskeys", "已授权 Passkey 凭据")}:</span>
                  <span className="font-mono">
                    {status?.wrappedPasskeys?.length || 1} {t("settings.e2eeDevicesUnit", "个设备")}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <Alert
        isOpen={isDisableAlertOpen}
        confirmButtonText={t("common.confirmDisable", "确认关闭")}
        cancelButtonText={t("common.cancel", "取消")}
        intent={Intent.DANGER}
        icon="unlock"
        onConfirm={handleConfirmDisable}
        onCancel={() => setIsDisableAlertOpen(false)}
        loading={processing}
      >
        <p>
          {t(
            "settings.e2eeDisableConfirm",
            "确定要关闭端到端加密吗？关闭后新生成的 DNS 日志将以明文存储。（已加密的历史日志仍需私钥解密）"
          )}
        </p>
      </Alert>
    </Card>
  );
};
