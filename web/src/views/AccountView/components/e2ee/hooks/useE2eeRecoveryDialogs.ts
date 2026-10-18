/**
 * @file useE2eeRecoveryDialogs.ts
 * @description Hook managing E2EE Recovery Key dialogs, unlocking, initialization, and auto-rotation modal.
 */

import { useState } from "react";
import { Intent, OverlayToaster } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { e2ee } from "../../../../../services";
import { rotateRecoveryKey } from "../../../../../services/account";

export interface UseE2eeRecoveryDialogsProps {
  onRefresh?: () => void;
  loadStatus: () => Promise<void>;
  setIsUnlocked: (val: boolean) => void;
  toasterRef: React.RefObject<OverlayToaster | null>;
  setProcessing: (val: boolean) => void;
}

export function useE2eeRecoveryDialogs({
  onRefresh,
  loadStatus,
  setIsUnlocked,
  toasterRef,
  setProcessing
}: UseE2eeRecoveryDialogsProps) {
  const { t } = useTranslation();

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
        console.warn("[useE2eeRecoveryDialogs] Recovery key auto-rotation failed:", rotateErr);
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
      console.error("[useE2eeRecoveryDialogs] Recovery unlock failed:", err);
      setRecoveryUnlockError((err as Error).message || t("account.e2ee.recoveryUnlockFailed"));
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
        console.warn("[useE2eeRecoveryDialogs] Recovery key auto-rotation failed:", rotateErr);
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
      console.error("[useE2eeRecoveryDialogs] Init keypair with recovery key failed:", err);
      setInitRecoveryError((err as Error).message || t("account.e2ee.initFailed"));
    } finally {
      setProcessing(false);
    }
  };

  const handleCopyRotatedKey = (k: string) => {
    navigator.clipboard.writeText(k);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  return {
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
    handleUnlockWithRecoveryKey,
    handleInitWithRecoveryKey,
    handleCopyRotatedKey
  };
}
