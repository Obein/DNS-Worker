import { useState, useEffect, useCallback, useRef } from "react";
import { Intent, OverlayToaster } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { e2ee, localDb } from "../../../services";
import { rotateRecoveryKey } from "../../../services/account";
import type { TimeRange } from "../types";

export interface UseLogsE2eeParams {
  profileId: string;
  range: TimeRange;
  fetchLogs: (range: TimeRange, isInitial?: boolean) => Promise<void>;
  toasterRef?: React.RefObject<OverlayToaster | null>;
}

export interface UseLogsE2eeReturn {
  isE2eeEnabled: boolean;
  isE2eeUnlocked: boolean;
  unlocking: boolean;
  recoveryDialogOpen: boolean;
  setRecoveryDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  recoveryKeyInput: string;
  setRecoveryKeyInput: React.Dispatch<React.SetStateAction<string>>;
  recoveryError: string;
  setRecoveryError: React.Dispatch<React.SetStateAction<string>>;
  rotatedKey: string | null;
  setRotatedKey: React.Dispatch<React.SetStateAction<string | null>>;
  copiedKey: boolean;
  handleCopyRotatedKey: (key: string) => void;
  handleUnlockPasskey: () => Promise<void>;
  handleUnlockRecoveryKey: (e: React.FormEvent) => Promise<void>;
}

/**
 * Hook to manage E2EE unlocking state, automatic unlock attempts,
 * and recovery key rotation flows within the Logs view.
 */
export function useLogsE2ee({
  profileId,
  range,
  fetchLogs,
  toasterRef
}: UseLogsE2eeParams): UseLogsE2eeReturn {
  const { t } = useTranslation();
  const [isE2eeEnabled, setIsE2eeEnabled] = useState<boolean>(false);
  const [isE2eeUnlocked, setIsE2eeUnlocked] = useState<boolean>(false);
  const [unlocking, setUnlocking] = useState<boolean>(false);

  // Recovery Key unlock dialog state
  const [recoveryDialogOpen, setRecoveryDialogOpen] = useState<boolean>(false);
  const [recoveryKeyInput, setRecoveryKeyInput] = useState<string>("");
  const [recoveryError, setRecoveryError] = useState<string>("");

  // Rotated Recovery Key notification modal state
  const [rotatedKey, setRotatedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<boolean>(false);

  const autoUnlockAttempted = useRef<boolean>(false);
  const lastProfileRef = useRef<string>(profileId);
  if (lastProfileRef.current !== profileId) {
    lastProfileRef.current = profileId;
    autoUnlockAttempted.current = false;
  }

  const checkE2ee = useCallback(async () => {
    try {
      const status = await e2ee.getStatus(profileId);
      const enabled = Boolean(status.enabled);
      setIsE2eeEnabled(enabled);

      const unlocked = e2ee.isProfileUnlocked(profileId);
      setIsE2eeUnlocked(unlocked);

      // Attempt automatic unlock on entry if enabled, not yet unlocked, and passkey available
      if (
        enabled &&
        !unlocked &&
        status.wrappedPasskeys &&
        status.wrappedPasskeys.length > 0 &&
        !autoUnlockAttempted.current
      ) {
        autoUnlockAttempted.current = true;
        try {
          const success = await e2ee.unlockProfile(profileId);
          if (success) {
            setIsE2eeUnlocked(true);
            await localDb.reDecryptLocalLogs(profileId);
            fetchLogs(range, true);
          }
        } catch (autoErr) {
          console.debug("[useLogsE2ee] Silent auto-unlock skipped or cancelled:", autoErr);
        }
      }
    } catch {
      setIsE2eeEnabled(false);
    }
  }, [profileId, fetchLogs, range]);

  useEffect(() => {
    checkE2ee();
  }, [checkE2ee]);

  const handleUnlockPasskey = async (): Promise<void> => {
    try {
      setUnlocking(true);
      const success = await e2ee.unlockProfile(profileId);
      if (success) {
        setIsE2eeUnlocked(true);
        await localDb.reDecryptLocalLogs(profileId);
        toasterRef?.current?.show({
          message: t("settings.e2eeUnlockSuccess", "私钥已成功在此设备解锁"),
          intent: Intent.SUCCESS
        });
        fetchLogs(range, true);
      }
    } catch (err: unknown) {
      console.error("Failed to unlock E2EE via Passkey:", err);
      toasterRef?.current?.show({
        message:
          (err as Error).message ||
          t("settings.e2eeUnlockError", "验证 Passkey 解锁失败"),
        intent: Intent.DANGER
      });
    } finally {
      setUnlocking(false);
    }
  };

  const handleUnlockRecoveryKey = async (e: React.FormEvent): Promise<void> => {
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
        console.warn("[useLogsE2ee] Recovery key auto-rotation failed:", rotateErr);
      }

      setIsE2eeUnlocked(true);
      setRecoveryDialogOpen(false);
      setRecoveryKeyInput("");
      await localDb.reDecryptLocalLogs(profileId);
      toasterRef?.current?.show({
        message: t("settings.e2eeUnlockSuccess", "私钥已成功在此设备解锁"),
        intent: Intent.SUCCESS
      });
      fetchLogs(range, true);
    } catch (err: unknown) {
      console.error("Failed to unlock E2EE via recovery key:", err);
      setRecoveryError(
        (err as Error).message ||
          t("account.e2ee.recoveryUnlockFailed", "恢复密钥无效或解析失败")
      );
    } finally {
      setUnlocking(false);
    }
  };

  const handleCopyRotatedKey = (k: string): void => {
    navigator.clipboard.writeText(k);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  return {
    isE2eeEnabled,
    isE2eeUnlocked,
    unlocking,
    recoveryDialogOpen,
    setRecoveryDialogOpen,
    recoveryKeyInput,
    setRecoveryKeyInput,
    recoveryError,
    setRecoveryError,
    rotatedKey,
    setRotatedKey,
    copiedKey,
    handleCopyRotatedKey,
    handleUnlockPasskey,
    handleUnlockRecoveryKey
  };
}
