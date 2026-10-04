import React, { useState, useEffect, useCallback } from "react";
import {
  Spinner,
  Callout,
  Button,
  Intent,
  Dialog,
  Classes,
  InputGroup,
  FormGroup,
} from "@blueprintjs/core";
import { Key, Copy, Check, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { clsx } from "clsx";

import type { LogEntry, LogsViewProps } from "./types";
import { useIsMobile } from "../../hooks/useIsMobile";
import { LogsHeader } from "./components/LogsHeader";
import { LogsContent } from "./components/LogsContent";
import { LogDetailsDrawer } from "./components/LogDetailsDrawer";
import { useLogs } from "./hooks/useLogs";
import { e2ee, localDb } from "../../services";
import { rotateRecoveryKey } from "../../services/account";

export const LogsView: React.FC<LogsViewProps> = ({ profileId, onQuickAction, toasterRef }) => {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isE2eeEnabled, setIsE2eeEnabled] = useState(false);
  const [isE2eeUnlocked, setIsE2eeUnlocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);

  // Recovery Key unlock dialog state
  const [recoveryDialogOpen, setRecoveryDialogOpen] = useState(false);
  const [recoveryKeyInput, setRecoveryKeyInput] = useState("");
  const [recoveryError, setRecoveryError] = useState("");

  // Rotated Recovery Key notification modal state
  const [rotatedKey, setRotatedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const {
    // states
    realtimeRefresh,
    setRealtimeRefresh,

    // filters
    range,
    setRange,
    customRange,
    setCustomRange,
    statusFilter,
    setStatusFilter,
    accessPointIdFilter,
    setAccessPointIdFilter,
    accessPoints,
    destCountryFilter,
    setDestCountryFilter,
    ispFilter,
    setIspFilter,
    searchQuery,
    setSearchQuery,

    // data
    logs,
    loading,
    loadingMore,
    hasMore,
    stats,
    logRetentionDays,
    prevLatestTimestamp,
    scrollContainerRef,
    lastLogElementRef,
    fetchLogs,

    // export
    exporting,
    handleExportLogs,
  } = useLogs({ profileId, toasterRef });

  const checkE2ee = useCallback(async () => {
    try {
      const status = await e2ee.getStatus(profileId);
      setIsE2eeEnabled(status.enabled || Boolean(status.hasKeys));
      setIsE2eeUnlocked(e2ee.isProfileUnlocked(profileId));
    } catch {
      setIsE2eeEnabled(false);
    }
  }, [profileId]);

  useEffect(() => {
    checkE2ee();
  }, [checkE2ee]);

  const handleUnlockPasskey = async () => {
    try {
      setUnlocking(true);
      const success = await e2ee.unlockProfile(profileId);
      if (success) {
        setIsE2eeUnlocked(true);
        await localDb.reDecryptLocalLogs(profileId);
        toasterRef?.current?.show({
          message: t("settings.e2eeUnlockSuccess", "私钥已成功在此设备解锁"),
          intent: Intent.SUCCESS,
        });
        fetchLogs(range, true);
      }
    } catch (err: any) {
      console.error("Failed to unlock E2EE via Passkey:", err);
      toasterRef?.current?.show({
        message: err.message || t("settings.e2eeUnlockError", "验证 Passkey 解锁失败"),
        intent: Intent.DANGER,
      });
    } finally {
      setUnlocking(false);
    }
  };

  const handleUnlockRecoveryKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = recoveryKeyInput.trim();
    if (!key) return;

    setUnlocking(true);
    setRecoveryError("");
    try {
      await e2ee.unlockWithRecoveryKey(key);

      // Auto-rotate recovery key immediately upon use
      try {
        const rotateRes = await rotateRecoveryKey({ recoveryKey: key });
        await e2ee.wrapCurrentKeyForRecovery(rotateRes.recovery_key);
        setRotatedKey(rotateRes.recovery_key);
      } catch (rotateErr) {
        console.warn("[LogsView] Recovery key auto-rotation failed:", rotateErr);
      }

      setIsE2eeUnlocked(true);
      setRecoveryDialogOpen(false);
      setRecoveryKeyInput("");
      await localDb.reDecryptLocalLogs(profileId);
      toasterRef?.current?.show({
        message: t("settings.e2eeUnlockSuccess", "私钥已成功在此设备解锁"),
        intent: Intent.SUCCESS,
      });
      fetchLogs(range, true);
    } catch (err: any) {
      console.error("Failed to unlock E2EE via recovery key:", err);
      setRecoveryError(err.message || t("account.e2ee.recoveryUnlockFailed", "恢复密钥无效或解析失败"));
    } finally {
      setUnlocking(false);
    }
  };

  const handleCopyRotatedKey = (k: string) => {
    navigator.clipboard.writeText(k);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const nowStr = new Date().toLocaleString("sv-SE").replace(" ", "T").slice(0, 16);

  if (loading && logs.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-gray-50/30 dark:bg-gray-950/10 max-w-7xl mx-auto w-full pt-14">
      <LogsHeader
        profileId={profileId}
        range={range}
        setRange={setRange}
        customRange={customRange}
        setCustomRange={setCustomRange}
        nowStr={nowStr}
        fetchLogs={fetchLogs}
        isMobile={isMobile}
        realtimeRefresh={realtimeRefresh}
        setRealtimeRefresh={setRealtimeRefresh}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        accessPointIdFilter={accessPointIdFilter}
        setAccessPointIdFilter={setAccessPointIdFilter}
        accessPoints={accessPoints}
        destCountryFilter={destCountryFilter}
        setDestCountryFilter={setDestCountryFilter}
        ispFilter={ispFilter}
        setIspFilter={setIspFilter}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        stats={stats}
        logRetentionDays={logRetentionDays}
        onExport={handleExportLogs}
        exporting={exporting}
      />

      {isE2eeEnabled && !isE2eeUnlocked && (
        <div className={clsx("mb-2 shrink-0", isMobile ? "px-2" : "px-4")}>
          <Callout
            intent={Intent.PRIMARY}
            icon="lock"
            title={t("settings.e2eeTitle", "端到端加密日志")}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-1">
              <p className="text-xs opacity-80 m-0">
                {t("settings.e2eeUnlockPrompt", "日志已通过端到端加密保护。请验证已授权的硬件 Passkey 或输入紧急恢复密钥以在本地解密。")}
              </p>
              <div className="flex items-center gap-2 flex-wrap shrink-0">
                <Button
                  intent={Intent.PRIMARY}
                  icon="key"
                  small
                  loading={unlocking}
                  onClick={handleUnlockPasskey}
                  className="font-medium"
                >
                  {t("settings.e2eeUnlockNow", "验证 Passkey 解锁")}
                </Button>
                <Button
                  intent={Intent.NONE}
                  icon={<Key size={14} />}
                  small
                  disabled={unlocking}
                  onClick={() => {
                    setRecoveryError("");
                    setRecoveryKeyInput("");
                    setRecoveryDialogOpen(true);
                  }}
                  className="font-medium"
                >
                  {t("settings.e2eeUnlockRecovery", "使用恢复密钥解锁")}
                </Button>
              </div>
            </div>
          </Callout>
        </div>
      )}

      <LogsContent
        logs={logs}
        loading={loading}
        loadingMore={loadingMore}
        hasMore={hasMore}
        realtimeRefresh={realtimeRefresh}
        isMobile={isMobile}
        searchQuery={searchQuery}
        scrollContainerRef={scrollContainerRef}
        lastLogElementRef={lastLogElementRef}
        prevLatestTimestamp={prevLatestTimestamp}
        setSelectedLog={setSelectedLog}
        setIsDrawerOpen={setIsDrawerOpen}
        logRetentionDays={logRetentionDays}
      />

      <LogDetailsDrawer
        isDrawerOpen={isDrawerOpen}
        setIsDrawerOpen={setIsDrawerOpen}
        selectedLog={selectedLog}
        profileId={profileId}
        isMobile={isMobile}
        onQuickAction={onQuickAction}
      />

      {/* Recovery Key Unlock Dialog */}
      <Dialog
        isOpen={recoveryDialogOpen}
        onClose={() => setRecoveryDialogOpen(false)}
        title={t("account.e2ee.unlockWithRecoveryTitle", "使用恢复密钥解锁")}
        icon="key"
        className="dark:bg-gray-900"
      >
        <form onSubmit={handleUnlockRecoveryKey}>
          <div className={Classes.DIALOG_BODY}>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              {t(
                "account.e2ee.unlockWithRecoveryDesc",
                "请输入 30 位紧急恢复密钥。注意：根据单次使用规则，恢复密钥验证成功后将立即自动轮换。"
              )}
            </p>
            {recoveryError && (
              <Callout intent={Intent.DANGER} className="mb-3 text-xs">
                {recoveryError}
              </Callout>
            )}
            <FormGroup
              label={t("account.e2ee.recoveryKeyInputLabel", "恢复密钥")}
              labelFor="recovery-key-input-logs"
            >
              <InputGroup
                id="recovery-key-input-logs"
                placeholder="123456-789012-345678-901234-567890"
                value={recoveryKeyInput}
                onChange={(e) => setRecoveryKeyInput(e.target.value)}
                leftIcon="key"
                className="font-mono text-xs"
                autoFocus
              />
            </FormGroup>
          </div>
          <div className={Classes.DIALOG_FOOTER}>
            <div className={Classes.DIALOG_FOOTER_ACTIONS}>
              <Button onClick={() => setRecoveryDialogOpen(false)} text={t("common.cancel", "取消")} />
              <Button
                type="submit"
                intent={Intent.PRIMARY}
                loading={unlocking}
                disabled={!recoveryKeyInput.trim()}
                text={t("account.e2ee.unlockConfirm", "解锁日志")}
              />
            </div>
          </div>
        </form>
      </Dialog>

      {/* Rotated Recovery Key Notification Modal */}
      <Dialog
        isOpen={!!rotatedKey}
        onClose={() => setRotatedKey(null)}
        title={t("account.recoveryKey.autoRotatedTitle", "恢复密钥已自动轮换")}
        icon="warning-sign"
        isCloseButtonShown={false}
        canOutsideClickClose={false}
        className="dark:bg-gray-900"
      >
        <div className={Classes.DIALOG_BODY}>
          <Callout intent={Intent.WARNING} icon={<ShieldAlert size={16} />} className="mb-4 text-xs">
            {t(
              "account.recoveryKey.autoRotatedNotice",
              "根据恢复密钥单次使用规则，您的原恢复密钥已失效，系统已为您生成全新 30 位紧急恢复密钥。请务必立即复制并妥善离线保存，关闭后将无法再次查看！"
            )}
          </Callout>

          {rotatedKey && (
            <div className="space-y-3">
              <div className="p-3 bg-gray-100 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 font-mono text-center text-lg font-bold tracking-widest select-all text-gray-900 dark:text-gray-100">
                {rotatedKey}
              </div>
              <div className="flex justify-center">
                <Button
                  intent={Intent.PRIMARY}
                  icon={copiedKey ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                  text={copiedKey ? t("common.copied", "已复制") : t("common.copyKey", "复制新恢复密钥")}
                  onClick={() => handleCopyRotatedKey(rotatedKey)}
                />
              </div>
            </div>
          )}
        </div>
        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button
              intent={Intent.SUCCESS}
              onClick={() => setRotatedKey(null)}
              text={t("account.recoveryKey.savedAndClose", "我已妥善保存并继续")}
            />
          </div>
        </div>
      </Dialog>
    </div>
  );
};
