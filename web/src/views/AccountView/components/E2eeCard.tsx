import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Card,
  Elevation,
  H4,
  Switch,
  Button,
  Intent,
  Tag,
  Callout,
  Alert,
  OverlayToaster,
  Spinner,
  HTMLSelect,
  Divider,
} from "@blueprintjs/core";
import {
  Lock,
  ShieldCheck,
  KeyRound,
  RefreshCw,
  FileText,
  Filter,
  Laptop,
  Layers,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { UserInfo } from "../types";
import { e2ee, getProfiles } from "../../../services";
import type { ProfileE2eeStatus, Profile } from "../../../services";

export interface E2eeCardProps {
  /** The current user profile and security state. */
  user: UserInfo;
  /** Callback triggered to re-fetch the latest user data. */
  onRefresh?: () => void;
}

/**
 * Data category item representation for extensible E2EE scopes.
 */
export interface E2eeScopeItem {
  id: "logs" | "rules" | "clients";
  title: string;
  desc: string;
  icon: React.ReactNode;
  status: "active" | "planned";
  enabled: boolean;
  interactive: boolean;
}

/**
 * E2eeCard manages Account-Level End-to-End Encryption (E2EE).
 * Provides hardware Passkey envelope encryption for DNS query logs
 * and retains architecture for future data scopes (rules, client metadata).
 */
export const E2eeCard: React.FC<E2eeCardProps> = ({ user, onRefresh }) => {
  const { t } = useTranslation();
  const toasterRef = useRef<OverlayToaster | null>(null);

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [status, setStatus] = useState<ProfileE2eeStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [processing, setProcessing] = useState<boolean>(false);
  const [isDisableAlertOpen, setIsDisableAlertOpen] = useState<boolean>(false);
  const [isUnlocked, setIsUnlocked] = useState<boolean>(false);

  // 1. Fetch all user profiles on mount
  useEffect(() => {
    let isMounted = true;
    getProfiles()
      .then((data) => {
        if (isMounted) {
          setProfiles(data || []);
          if (data && data.length > 0 && !selectedProfileId) {
            setSelectedProfileId(data[0].id);
          }
        }
      })
      .catch((err) => {
        console.error("[E2eeCard] Failed to fetch profiles:", err);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  // 2. Load E2EE status for currently selected profile
  const loadStatus = useCallback(async (profileId: string) => {
    if (!profileId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await e2ee.getStatus(profileId);
      setStatus(data);
      setIsUnlocked(e2ee.isProfileUnlocked(profileId));
    } catch (err) {
      console.error("[E2eeCard] Failed to fetch E2EE status:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedProfileId) {
      loadStatus(selectedProfileId);
    }
  }, [selectedProfileId, loadStatus]);

  const hasPasskey = (user.passkeys_count && user.passkeys_count > 0) || (status?.userPasskeyCount || 0) > 0;
  const isLogsE2eeEnabled = Boolean(status?.enabled);

  // 3. Handle toggle for DNS Query Logs encryption
  const handleToggleLogs = async (checked: boolean) => {
    if (!selectedProfileId) return;

    if (checked) {
      setProcessing(true);
      try {
        const passkeyId = status?.wrappedPasskeys[0] || "primary";
        await e2ee.enableE2ee(selectedProfileId, passkeyId);
        toasterRef.current?.show({
          message: t("account.e2ee.enableSuccess", "端到端加密已成功启用"),
          intent: Intent.SUCCESS,
          icon: "lock",
        });
        await loadStatus(selectedProfileId);
        onRefresh?.();
      } catch (err: any) {
        console.error("[E2eeCard] Failed to enable E2EE:", err);
        toasterRef.current?.show({
          message: err.message || t("account.e2ee.enableError", "启用端到端加密失败"),
          intent: Intent.DANGER,
          icon: "error",
        });
      } finally {
        setProcessing(false);
      }
    } else {
      setIsDisableAlertOpen(true);
    }
  };

  const handleConfirmDisable = async () => {
    if (!selectedProfileId) return;
    setProcessing(true);
    try {
      await e2ee.disableE2ee(selectedProfileId);
      toasterRef.current?.show({
        message: t("account.e2ee.disableSuccess", "端到端加密已关闭"),
        intent: Intent.WARNING,
        icon: "unlock",
      });
      await loadStatus(selectedProfileId);
      onRefresh?.();
    } catch (err: any) {
      console.error("[E2eeCard] Failed to disable E2EE:", err);
      toasterRef.current?.show({
        message: err.message || t("account.e2ee.disableError", "关闭端到端加密失败"),
        intent: Intent.DANGER,
        icon: "error",
      });
    } finally {
      setProcessing(false);
      setIsDisableAlertOpen(false);
    }
  };

  // 4. Handle Passkey unlock on this device
  const handleUnlock = async () => {
    if (!selectedProfileId) return;
    setProcessing(true);
    try {
      const success = await e2ee.unlockProfile(selectedProfileId);
      if (success) {
        setIsUnlocked(true);
        toasterRef.current?.show({
          message: t("account.e2ee.unlockSuccess", "私钥已成功在此设备解锁"),
          intent: Intent.SUCCESS,
          icon: "tick",
        });
      }
    } catch (err: any) {
      console.error("[E2eeCard] Failed to unlock private key:", err);
      toasterRef.current?.show({
        message: err.message || t("account.e2ee.unlockError", "验证 Passkey 解锁失败"),
        intent: Intent.DANGER,
        icon: "error",
      });
    } finally {
      setProcessing(false);
    }
  };

  // Extensible Data Scopes definition
  const scopes: E2eeScopeItem[] = [
    {
      id: "logs",
      title: t("account.e2ee.scopeLogsTitle", "DNS 查询日志"),
      desc: t(
        "account.e2ee.scopeLogsDesc",
        "在边缘加密 DNS 请求的域名、客户端 IP、解析记录及上游信息，防止云端日志被窃取或留存明文。"
      ),
      icon: <FileText size={16} className="text-emerald-500 shrink-0" />,
      status: "active",
      enabled: isLogsE2eeEnabled,
      interactive: true,
    },
    {
      id: "rules",
      title: t("account.e2ee.scopeRulesTitle", "自定义规则与重定向"),
      desc: t(
        "account.e2ee.scopeRulesDesc",
        "端到端加密自定义拦截/放行规则与 URL 重定向配置。"
      ),
      icon: <Filter size={16} className="text-blue-400 shrink-0" />,
      status: "planned",
      enabled: false,
      interactive: false,
    },
    {
      id: "clients",
      title: t("account.e2ee.scopeClientsTitle", "设备别名与客户端元数据"),
      desc: t(
        "account.e2ee.scopeClientsDesc",
        "端到端加密接入点设备名称、IP 别名与拓扑信息。"
      ),
      icon: <Laptop size={16} className="text-purple-400 shrink-0" />,
      status: "planned",
      enabled: false,
      interactive: false,
    },
  ];

  return (
    <Card elevation={Elevation.ONE} className="space-y-6">
      <OverlayToaster ref={toasterRef} />

      <div>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Lock
              size={20}
              className={isLogsE2eeEnabled ? "text-emerald-500" : "text-gray-400"}
            />
            <H4 style={{ margin: 0 }}>
              {t("account.e2ee.title", "端到端加密 (E2EE)")}
            </H4>
            <Tag
              intent={isLogsE2eeEnabled ? Intent.SUCCESS : Intent.NONE}
              minimal
              round
            >
              {isLogsE2eeEnabled
                ? t("account.e2ee.enabled", "已启用")
                : t("account.e2ee.disabled", "未启用")}
            </Tag>
          </div>

          {/* Profile Switcher for multi-profile users */}
          {profiles.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-xs opacity-70">
                {t("account.e2ee.profileSelect", "配置 Profile")}:
              </span>
              <HTMLSelect
                value={selectedProfileId}
                onChange={(e) => setSelectedProfileId(e.currentTarget.value)}
                disabled={processing || loading}
                className="text-xs"
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </HTMLSelect>
            </div>
          )}
        </div>

        {/* Global Description */}
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          {t(
            "account.e2ee.desc",
            "采用客户端 ECDH P-256 + AES-256-GCM 硬件信封加密技术。数据在边缘即刻加密，服务端仅存储不可逆密文，只有已授权硬件 Passkey 的设备可在本地解密并分析。"
          )}
        </p>

        {/* Passkey Dependency Alert */}
        {!hasPasskey ? (
          <Callout intent={Intent.WARNING} icon="key" className="text-xs mt-3">
            <p>
              {t(
                "account.e2ee.passkeyRequired",
                "端到端加密需要硬件 Passkey (WebAuthn) 支持。请在上方「双重认证 (MFA)」设置中先添加至少一个 Passkey 凭据。"
              )}
            </p>
          </Callout>
        ) : loading ? (
          <div className="flex items-center justify-center p-6">
            <Spinner size={20} />
          </div>
        ) : (
          <div className="space-y-4">
            <Divider className="my-2" />

            {/* Extensible Encrypted Data Scopes Section */}
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Layers size={15} className="text-emerald-500" />
                <span className="font-semibold text-xs uppercase tracking-wider text-gray-700 dark:text-gray-300">
                  {t("account.e2ee.scopesTitle", "数据加密范围")}
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                {t(
                  "account.e2ee.scopesSubtitle",
                  "选择通过硬件 Passkey 进行端到端加密保护的数据类型。"
                )}
              </p>

              <div className="divide-y divide-gray-100 dark:divide-gray-800/80 rounded-lg border border-gray-100 dark:border-gray-800/80 p-3 bg-gray-50/50 dark:bg-gray-900/40 space-y-3">
                {scopes.map((scope) => (
                  <div
                    key={scope.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-3 first:pt-0"
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5">{scope.icon}</div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {scope.title}
                          </span>
                          {scope.status === "planned" && (
                            <Tag minimal className="text-[10px]" intent={Intent.NONE}>
                              {t("account.e2ee.statusPlanned", "规划中")}
                            </Tag>
                          )}
                          {scope.status === "active" && (
                            <Tag
                              minimal
                              className="text-[10px]"
                              intent={scope.enabled ? Intent.SUCCESS : Intent.NONE}
                            >
                              {scope.enabled
                                ? t("account.e2ee.statusActive", "已保护")
                                : t("account.e2ee.disabled", "未加密")}
                            </Tag>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {scope.desc}
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center justify-end">
                      {scope.interactive ? (
                        <Switch
                          checked={scope.enabled}
                          disabled={processing || loading}
                          onChange={(e) => handleToggleLogs(e.currentTarget.checked)}
                          className="mb-0"
                        />
                      ) : (
                        <Switch checked={false} disabled className="mb-0 opacity-40" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Hardware Key & Device Status (shown when E2EE is enabled) */}
            {isLogsE2eeEnabled && (
              <div className="pt-2 border-t border-gray-100 dark:border-gray-800/80 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="opacity-70 flex items-center gap-1.5">
                    <KeyRound size={13} />
                    {t("account.e2ee.keyType", "加密算法")}:
                  </span>
                  <span className="font-mono">ECDH P-256 + AES-256-GCM</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="opacity-70 flex items-center gap-1.5">
                    <ShieldCheck size={13} />
                    {t("account.e2ee.deviceState", "当前设备状态")}:
                  </span>
                  {isUnlocked ? (
                    <Tag minimal intent={Intent.SUCCESS} className="text-[10px]">
                      {t("account.e2ee.unlocked", "已在此设备解锁")}
                    </Tag>
                  ) : (
                    <Button
                      small
                      minimal
                      intent={Intent.PRIMARY}
                      icon={<RefreshCw size={12} />}
                      text={t("account.e2ee.unlockButton", "验证 Passkey 解锁")}
                      loading={processing}
                      onClick={handleUnlock}
                    />
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <span className="opacity-70">
                    {t("account.e2ee.protectedPasskeys", "已授权 Passkey 凭据")}:
                  </span>
                  <span className="font-mono">
                    {status?.wrappedPasskeys?.length || 1}{" "}
                    {t("account.e2ee.devicesUnit", "个凭据")}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Confirmation Alert for Disabling E2EE */}
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
            "account.e2ee.disableConfirm",
            "确定要关闭端到端加密吗？关闭后新生成的 DNS 日志将以明文存储。（已加密的历史日志仍需私钥解密）"
          )}
        </p>
      </Alert>
    </Card>
  );
};
