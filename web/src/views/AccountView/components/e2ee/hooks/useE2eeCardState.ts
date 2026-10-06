import { useState, useEffect, useCallback, useMemo } from "react";
import { Intent, OverlayToaster } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import type { UserInfo } from "../../../types";
import { e2ee } from "../../../../../services";
import type { ProfileE2eeStatus } from "../../../../../services";
import { rotateRecoveryKey } from "../../../../../services/account";

export interface UseE2eeCardStateProps {
  user: UserInfo;
  onRefresh?: () => void;
  toasterRef: React.RefObject<OverlayToaster | null>;
}

export function useE2eeCardState({
  user,
  onRefresh,
  toasterRef
}: UseE2eeCardStateProps) {
  const { t } = useTranslation();

  const [status, setStatus] = useState<ProfileE2eeStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [processing, setProcessing] = useState<boolean>(false);
  const [isDisableAlertOpen, setIsDisableAlertOpen] = useState<boolean>(false);
  const [isUnlocked, setIsUnlocked] = useState<boolean>(false);

  // Recovery Key unlock dialog state
  const [isRecoveryDialogOpen, setIsRecoveryDialogOpen] = useState<boolean>(false);
  const [recoveryKeyInput, setRecoveryKeyInput] = useState<string>("");
  const [recoveryUnlockError, setRecoveryUnlockError] = useState<string>("");

  // Recovery Key init keypair dialog state (for existing users with no keys)
  const [initRecoveryDialogOpen, setInitRecoveryDialogOpen] = useState<boolean>(false);
  const [initRecoveryKeyInput, setInitRecoveryKeyInput] = useState<string>("");
  const [initRecoveryError, setInitRecoveryError] = useState<string>("");

  // Auto-rotated recovery key modal state
  const [rotatedKey, setRotatedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<boolean>(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await e2ee.getUserStatus();
      setStatus(data);
      setIsUnlocked(e2ee.isUnlocked());
    } catch (err) {
      console.error("[useE2eeCardState] Failed to fetch E2EE status:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const hasPasskey =
    (user.passkeys_count && user.passkeys_count > 0) ||
    (status?.userPasskeyCount || 0) > 0;
  const isLogsE2eeEnabled = Boolean(status?.enabled);

  const isPqc = useMemo(() => {
    if (!status?.publicKey) return false;
    try {
      const parsed = JSON.parse(status.publicKey);
      return parsed.alg === "P256-MLKEM768" || Boolean(parsed.pqc_pk);
    } catch {
      return false;
    }
  }, [status?.publicKey]);

  const handleToggleLogs = async (checked: boolean) => {
    if (checked) {
      setProcessing(true);
      try {
        await e2ee.enableUserE2ee();
        toasterRef.current?.show({
          message: t("account.e2ee.enableSuccess"),
          intent: Intent.SUCCESS,
          icon: "lock"
        });
        await loadStatus();
        onRefresh?.();
      } catch (err: unknown) {
        console.error("[useE2eeCardState] Failed to enable E2EE:", err);
        toasterRef.current?.show({
          message: (err as Error).message || t("account.e2ee.enableError"),
          intent: Intent.DANGER,
          icon: "error"
        });
      } finally {
        setProcessing(false);
      }
    } else {
      setIsDisableAlertOpen(true);
    }
  };

  const handleConfirmDisable = async () => {
    setProcessing(true);
    try {
      await e2ee.disableUserE2ee();
      toasterRef.current?.show({
        message: t("account.e2ee.disableSuccess"),
        intent: Intent.WARNING,
        icon: "unlock"
      });
      await loadStatus();
      onRefresh?.();
    } catch (err: unknown) {
      console.error("[useE2eeCardState] Failed to disable E2EE:", err);
      toasterRef.current?.show({
        message: (err as Error).message || t("account.e2ee.disableError"),
        intent: Intent.DANGER,
        icon: "error"
      });
    } finally {
      setProcessing(false);
      setIsDisableAlertOpen(false);
    }
  };

  const handleUnlock = async () => {
    setProcessing(true);
    try {
      const success = await e2ee.unlockUser();
      if (success) {
        setIsUnlocked(true);
        toasterRef.current?.show({
          message: t("account.e2ee.unlockSuccess"),
          intent: Intent.SUCCESS,
          icon: "tick"
        });
      }
    } catch (err: unknown) {
      console.error("[useE2eeCardState] Failed to unlock private key:", err);
      toasterRef.current?.show({
        message: (err as Error).message || t("account.e2ee.unlockError"),
        intent: Intent.DANGER,
        icon: "error"
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleUnlockWithRecoveryKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = recoveryKeyInput.trim();
    if (!key) return;

    setProcessing(true);
    setRecoveryUnlockError("");
    try {
      await e2ee.unlockWithRecoveryKey(key);

      try {
        const rotateRes = await rotateRecoveryKey({ recoveryKey: key });
        await e2ee.wrapCurrentKeyForRecovery(rotateRes.recovery_key);
        setRotatedKey(rotateRes.recovery_key);
      } catch (rotateErr) {
        console.warn("[useE2eeCardState] Recovery key auto-rotation failed:", rotateErr);
      }

      setIsUnlocked(true);
      setIsRecoveryDialogOpen(false);
      setRecoveryKeyInput("");
      toasterRef.current?.show({
        message: t("account.e2ee.unlockSuccess"),
        intent: Intent.SUCCESS,
        icon: "tick"
      });
      await loadStatus();
      onRefresh?.();
    } catch (err: unknown) {
      console.error("[useE2eeCardState] Recovery unlock failed:", err);
      setRecoveryUnlockError((err as Error).message || t("account.e2ee.recoveryUnlockFailed"));
    } finally {
      setProcessing(false);
    }
  };

  const handleGenerateKeyWithPasskey = async () => {
    setProcessing(true);
    try {
      await e2ee.enableUserE2ee();
      toasterRef.current?.show({
        message: t("account.e2ee.keypairGenSuccess"),
        intent: Intent.SUCCESS,
        icon: "tick"
      });
      await loadStatus();
      onRefresh?.();
    } catch (err: unknown) {
      console.error("[useE2eeCardState] Generate key with Passkey failed:", err);
      toasterRef.current?.show({
        message: (err as Error).message || t("account.e2ee.keypairGenError"),
        intent: Intent.DANGER,
        icon: "error"
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleUpgradeToPqc = async () => {
    setProcessing(true);
    try {
      await e2ee.rotateUserE2eeKey();
      toasterRef.current?.show({
        message: t("account.e2ee.upgradePqcSuccess", "已成功升级到后量子混合加密 (P256-MLKEM768)"),
        intent: Intent.SUCCESS,
        icon: "tick"
      });
      await loadStatus();
      onRefresh?.();
    } catch (err: unknown) {
      console.error("[useE2eeCardState] Upgrade to PQC failed:", err);
      toasterRef.current?.show({
        message: (err as Error).message || t("account.e2ee.upgradePqcError", "升级到后量子加密失败"),
        intent: Intent.DANGER,
        icon: "error"
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleInitWithRecoveryKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = initRecoveryKeyInput.trim();
    if (!key) return;

    setProcessing(true);
    setInitRecoveryError("");
    try {
      await e2ee.initUserE2eeWithRecoveryKey(key);

      try {
        const rotateRes = await rotateRecoveryKey({ recoveryKey: key });
        await e2ee.wrapCurrentKeyForRecovery(rotateRes.recovery_key);
        setRotatedKey(rotateRes.recovery_key);
      } catch (rotateErr) {
        console.warn("[useE2eeCardState] Recovery key auto-rotation failed:", rotateErr);
      }

      setInitRecoveryDialogOpen(false);
      setInitRecoveryKeyInput("");
      setIsUnlocked(true);
      toasterRef.current?.show({
        message: t("account.e2ee.keypairGenSuccess"),
        intent: Intent.SUCCESS,
        icon: "tick"
      });
      await loadStatus();
      onRefresh?.();
    } catch (err: unknown) {
      console.error("[useE2eeCardState] Init keypair with recovery key failed:", err);
      setInitRecoveryError((err as Error).message || t("account.e2ee.initFailed"));
    } finally {
      setProcessing(false);
    }
  };

  const handleLockDevice = () => {
    e2ee.clearStorage();
    setIsUnlocked(false);
    toasterRef.current?.show({
      message: t("account.e2ee.lockSuccess", "已锁定，私钥已从本地清除"),
      intent: Intent.NONE
    });
  };

  const handleCopyRotatedKey = (k: string) => {
    navigator.clipboard.writeText(k);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  return {
    status,
    loading,
    processing,
    isUnlocked,
    isPqc,
    isLogsE2eeEnabled,
    hasPasskey,
    isDisableAlertOpen,
    setIsDisableAlertOpen,
    isRecoveryDialogOpen,
    setIsRecoveryDialogOpen,
    recoveryKeyInput,
    setRecoveryKeyInput,
    recoveryUnlockError,
    setRecoveryUnlockError,
    initRecoveryDialogOpen,
    setInitRecoveryDialogOpen,
    initRecoveryKeyInput,
    setInitRecoveryKeyInput,
    initRecoveryError,
    setInitRecoveryError,
    rotatedKey,
    setRotatedKey,
    copiedKey,
    handleToggleLogs,
    handleConfirmDisable,
    handleUnlock,
    handleUnlockWithRecoveryKey,
    handleGenerateKeyWithPasskey,
    handleUpgradeToPqc,
    handleInitWithRecoveryKey,
    handleLockDevice,
    handleCopyRotatedKey
  };
}
